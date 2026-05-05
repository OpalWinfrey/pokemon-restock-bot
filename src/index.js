import "dotenv/config";
import cron from "node-cron";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { validateEnv } from "./validate.js";
import { log } from "./logger.js";
import { loadDiscordConfig } from "./discord-config.js";
import { getStoresNearZip } from "./stores.js";
import { discoverProducts } from "./discover.js";
import { getUsers } from "./users.js";
import { checkTarget }         from "./checkers/target.js";
import { checkWalmart }        from "./checkers/walmart.js";
import { checkCostco }         from "./checkers/costco.js";
import { checkSamsClub }       from "./checkers/samsclub.js";
import { checkMeijer }         from "./checkers/meijer.js";
import { checkWalgreens }      from "./checkers/walgreens.js";
import { checkCVS }            from "./checkers/cvs.js";
import { checkPokemonCenter }  from "./checkers/pokemoncenter.js";
import { sendRestockAlert, sendToLogs } from "./discord.js";
import { startServer, registerSlashCommands, getDiscordConfig } from "./server.js";
import { sleepJitter } from "./http.js";

validateEnv();

const __dir = dirname(fileURLToPath(import.meta.url));
const PRODUCTS_FILE = join(__dir, "../config/products.json");

const USER_ZIP              = process.env.USER_ZIP;
const SEARCH_RADIUS_MILES   = parseInt(process.env.SEARCH_RADIUS_MILES   || "20");
const POLL_INTERVAL         = parseInt(process.env.POLL_INTERVAL_SECONDS || "300");
const DISCOVER_INTERVAL_HRS = parseFloat(process.env.DISCOVER_INTERVAL_HOURS || "12");

export const botStats = { nearbyStores: {}, lastCheckTime: null };

const stockCounts = {}; // key → consecutive in-stock check count
function stateKey(productName, retailer, storeId) {
  return `${productName}__${retailer}__${storeId}`;
}

const CHECKERS = {
  target:    (cfg, id) => checkTarget({ tcin: cfg.tcin, storeId: id }),
  walmart:   (cfg, id) => checkWalmart({ itemId: cfg.itemId, storeId: id }),
  costco:    (cfg, id) => checkCostco({ itemNumber: cfg.itemNumber, warehouseId: id }),
  samsclub:  (cfg, id) => checkSamsClub({ itemId: cfg.itemId, clubId: id }),
  meijer:    (cfg, id) => checkMeijer({ itemId: cfg.itemId, storeId: id }),
  walgreens: (cfg, id) => checkWalgreens({ sku: cfg.sku, storeNum: id }),
  cvs:       (cfg, id) => checkCVS({ upc: cfg.upc, storeId: id })
};

const DISPLAY = {
  target: "Target", walmart: "Walmart", costco: "Costco",
  samsclub: "Sam's Club", meijer: "Meijer",
  walgreens: "Walgreens", cvs: "CVS",
  pokemoncenter: "Pokemon Center"
};

// Retailers that are online-only — checked once per product, not once per store
const ONLINE_ONLY_CHECKERS = {
  pokemoncenter: (cfg) => checkPokemonCenter({ itemId: cfg.itemId, url: cfg.url })
};

export async function buildStoreMap() {
  const map = await getStoresNearZip(USER_ZIP, SEARCH_RADIUS_MILES);
  for (const user of getUsers()) {
    if (!user.zip) continue;
    const userStores = await getStoresNearZip(user.zip, user.radiusMiles ?? SEARCH_RADIUS_MILES);
    for (const [retailer, stores] of Object.entries(userStores)) {
      const existing = new Set((map[retailer] ?? []).map(s => s.id));
      map[retailer] = [...(map[retailer] ?? []), ...stores.filter(s => !existing.has(s.id))];
    }
  }
  return map;
}

async function checkAll(storeMap, discordConfig) {
  log.info(`Checking stock... [${new Date().toLocaleTimeString()}]`);
  const products = JSON.parse(readFileSync(PRODUCTS_FILE, "utf8"));
  let restocksFound = 0;

  for (const product of products) {
    if (product.outOfPrint) { log.debug(`Skipping out-of-print: ${product.name}`); continue; }
    const { name, retailers, imageUrl = null, msrp = null } = product;

    for (const [retailerKey, cfg] of Object.entries(retailers)) {
      const displayName = DISPLAY[retailerKey] ?? retailerKey;

      // Online-only retailers (Pokemon Center) — check once per product, no store loop
      if (ONLINE_ONLY_CHECKERS[retailerKey]) {
        try {
          const { inStock, price } = await ONLINE_ONLY_CHECKERS[retailerKey](cfg);
          const key = stateKey(name, retailerKey, "online");
          if (inStock) {
            stockCounts[key] = (stockCounts[key] ?? 0) + 1;
            if (stockCounts[key] === 2) {
              log.info(`ONLINE DROP confirmed: ${name} at ${displayName}`);
              restocksFound++;
              await sendRestockAlert({
                productName: name, retailer: displayName, retailerKey,
                storeName: "Pokemon Center Online", storeAddress: "pokemoncenter.com", storeId: "online",
                url: cfg.url, price, imageUrl, msrp, discordConfig
              });
            } else {
              log.debug(`Online in stock (${stockCounts[key]}/2): ${name} at ${displayName}`);
            }
          } else {
            stockCounts[key] = 0;
          }
        } catch (err) {
          log.error(`Online check failed: ${name} at ${displayName}:`, err.message);
        }
        await sleepJitter(1000, 500);
        continue;
      }

      const stores = storeMap[retailerKey] ?? [];
      if (!stores.length) continue;

      const checker = CHECKERS[retailerKey];
      if (!checker) { log.warn(`No checker for "${retailerKey}" — skipping`); continue; }

      for (const store of stores) {
        try {
          const { inStock, price } = await checker(cfg, store.id);
          const key = stateKey(name, retailerKey, store.id);

          if (inStock) {
            stockCounts[key] = (stockCounts[key] ?? 0) + 1;
            // Confirm in stock on 2 consecutive checks before alerting
            if (stockCounts[key] === 2) {
              log.info(`RESTOCK confirmed: ${name} at ${displayName} — ${store.name}`);
              restocksFound++;
              await sendRestockAlert({
                productName: name, retailer: displayName, retailerKey,
                storeName: store.name, storeAddress: store.address, storeId: store.id,
                url: cfg.url, price, imageUrl, msrp, discordConfig
              });
            } else {
              log.debug(`In stock (${stockCounts[key]}/2 confirmations): ${name} at ${displayName} — ${store.name}`);
            }
          } else {
            stockCounts[key] = 0;
            log.debug(`Out of stock: ${name} at ${displayName} — ${store.name}`);
          }
        } catch (err) {
          log.error(`Check failed: ${name} at ${displayName} store ${store.id}:`, err.message);
        }
        await sleepJitter(300, 150); // 150–450ms between store requests
      }
      await sleepJitter(1000, 500); // 500ms–1.5s between retailers
    }
  }

  botStats.lastCheckTime = Date.now();
  if (restocksFound > 0) {
    await sendToLogs(discordConfig, `✅ Check complete — ${restocksFound} restock(s) found`);
  }
}

// --- Startup ---

log.info("🚀 Pokemon Restock Bot starting...");
log.info(`📍 ZIP: ${USER_ZIP} | Radius: ${SEARCH_RADIUS_MILES}mi | Poll: ${POLL_INTERVAL}s | Rediscover: every ${DISCOVER_INTERVAL_HRS}h`);

// Start the HTTP server immediately so Discord's endpoint verification succeeds
// while the slower discovery + store lookup runs in the background.
await registerSlashCommands();
const discordConfig = await loadDiscordConfig();
startServer(botStats, discordConfig, buildStoreMap);

function storeBreakdown(storeMap) {
  const lines = [];
  let total = 0;
  const empty = [];
  for (const [key, stores] of Object.entries(storeMap)) {
    const label = DISPLAY[key] ?? key;
    if (stores.length) { lines.push(`  • ${label}: ${stores.length} store(s)`); total += stores.length; }
    else empty.push(label);
  }
  if (empty.length) lines.push(`  • (0 stores found for: ${empty.join(", ")})`);
  return { lines, total };
}

// Background init — runs after server is already accepting requests
(async () => {
  // Delay first discovery 5 min so the server is stable before firing search requests
  log.info("⏳ First product discovery delayed 5 min to avoid startup blocking...");
  await new Promise(r => setTimeout(r, 5 * 60 * 1000));
  await discoverProducts(getDiscordConfig());

  const storeMap = await buildStoreMap();
  botStats.nearbyStores = storeMap;

  const products = JSON.parse(readFileSync(PRODUCTS_FILE, "utf8"));
  const { lines: breakdownLines, total: totalStores } = storeBreakdown(storeMap);

  if (totalStores === 0) {
    if (!USER_ZIP) {
      log.warn("⚠️  No stores found — USER_ZIP is not set in Railway variables");
    } else {
      log.warn(`⚠️  No stores found for zip ${USER_ZIP} — retailer store APIs may be blocking Railway's IP. Check logs above for HTTP errors.`);
    }
  }
  log.info(`📦 Tracking ${products.length} product(s)`);
  log.info(`📍 Stores within ${SEARCH_RADIUS_MILES}mi of ${USER_ZIP ?? "unset"}:`);
  breakdownLines.forEach(l => log.info(l));

  const cfg = getDiscordConfig();
  await sendToLogs(cfg, [
    `🚀 **Bot online** — polling every ${POLL_INTERVAL}s`,
    `📦 Tracking **${products.length}** product(s)`,
    `📍 Stores within **${SEARCH_RADIUS_MILES}mi** of \`${USER_ZIP ?? "⚠️ USER_ZIP not set"}\`:`,
    ...breakdownLines.map(l => l.trim()),
    totalStores === 0 ? "\n⚠️ **No stores found** — add `USER_ZIP` in Railway Variables and redeploy." : ""
  ].filter(Boolean).join("\n"));

  await checkAll(storeMap, cfg);

  cron.schedule(`*/${POLL_INTERVAL} * * * * *`, () =>
    checkAll(storeMap, getDiscordConfig()).catch(async err => {
      log.error("checkAll error:", err.message);
      await sendToLogs(getDiscordConfig(), `❌ Check loop error: ${err.message}`);
    })
  );
  setInterval(async () => {
    try {
      await discoverProducts(getDiscordConfig());
    } catch (err) {
      log.error("discoverProducts error:", err.message);
      await sendToLogs(getDiscordConfig(), `❌ Discovery error: ${err.message}`);
    }
  }, DISCOVER_INTERVAL_HRS * 60 * 60 * 1000);
})();
