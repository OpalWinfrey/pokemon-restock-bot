import "dotenv/config";
import cron from "node-cron";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { validateEnv } from "./validate.js";
import { log } from "./logger.js";
import { loadDiscordConfig } from "./discord-config.js";
import { findAndSaveNearbyStores } from "./stores.js";
import { discoverProducts } from "./discover.js";
import { checkTarget, checkTargetBatch } from "./checkers/target.js";
import { checkWalmart }        from "./checkers/walmart.js";
import { checkCostco }         from "./checkers/costco.js";
import { checkSamsClub }       from "./checkers/samsclub.js";
import { checkMeijer }         from "./checkers/meijer.js";
import { checkWalgreens }      from "./checkers/walgreens.js";
import { checkCVS }            from "./checkers/cvs.js";
import { checkPokemonCenter }  from "./checkers/pokemoncenter.js";
import { sendRestockAlert, sendToLogs } from "./discord.js";
import { startBot, registerSlashCommands, getDiscordConfig } from "./server.js";
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

// Target in-store check uses redsky pdp_client_v1 with store_id — works on residential IPs.
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

// Online-only checkers — always run regardless of whether nearby stores were found.
// Walmart and Target also run in-store via CHECKERS when locator returns results.
const ONLINE_ONLY_CHECKERS = {
  target:        (cfg) => checkTarget({ tcin: cfg.tcin }),
  walmart:       (cfg) => checkWalmart({ itemId: cfg.itemId }),
  pokemoncenter: (cfg) => checkPokemonCenter({ itemId: cfg.itemId, url: cfg.url })
};

export async function buildStoreMap(zip) {
  return findAndSaveNearbyStores(zip ?? USER_ZIP, SEARCH_RADIUS_MILES);
}

// Process batched Target results and fire alerts for any in-stock items.
async function processTargetResults(batchResults, targetProducts, storeId, storeName, storeAddress, discordConfig) {
  let restocksFound = 0;
  for (const { name, cfg, imageUrl, msrp } of targetProducts) {
    const tcin = String(cfg.tcin);
    const r = batchResults[tcin];
    if (!r) continue;
    const key = stateKey(name, "target", storeId ?? "online");
    if (r.inStock) {
      stockCounts[key] = (stockCounts[key] ?? 0) + 1;
      if (stockCounts[key] === 2) {
        log.info(`Target ${storeId ? `store ${storeName}` : "online"} RESTOCK confirmed: ${name}`);
        restocksFound++;
        await sendRestockAlert({
          productName: name, retailer: "Target", retailerKey: "target",
          storeName: storeId ? storeName : "Target.com",
          storeAddress: storeId ? storeAddress : cfg.url,
          storeId: storeId ?? "online",
          url: cfg.url, price: r.price, imageUrl, msrp, discordConfig
        });
      } else {
        log.debug(`Target ${storeId ?? "online"} in stock (${stockCounts[key]}/2): ${name}`);
      }
    } else {
      stockCounts[key] = 0;
    }
  }
  return restocksFound;
}

async function checkAll(storeMap, discordConfig) {
  log.info(`Checking stock... [${new Date().toLocaleTimeString()}]`);
  const products = JSON.parse(readFileSync(PRODUCTS_FILE, "utf8")).filter(p => !p.outOfPrint);
  let restocksFound = 0;

  // --- Target: batch all TCINs into a small number of API calls ---
  const targetProducts = products
    .filter(p => p.retailers?.target?.tcin)
    .map(p => ({ name: p.name, cfg: p.retailers.target, imageUrl: p.imageUrl ?? null, msrp: p.msrp ?? null }));

  if (targetProducts.length) {
    const BATCH = 20;
    const tcins = targetProducts.map(p => p.cfg.tcin);

    // Online batch (1 call per 20 products = ~4 calls for 73 products)
    for (let i = 0; i < tcins.length; i += BATCH) {
      const batch = tcins.slice(i, i + BATCH);
      try {
        const results = await checkTargetBatch(batch, null);
        log.debug(`Target online batch ${Math.floor(i/BATCH)+1}: ${Object.values(results).filter(r=>r.inStock).length} in stock`);
        restocksFound += await processTargetResults(results, targetProducts.slice(i, i + BATCH), null, null, null, discordConfig);
      } catch (err) {
        log.error(`Target online batch failed:`, err.message);
      }
      await sleepJitter(2000, 500);
    }

    // In-store batch per store (1 call per 20 products per store)
    for (const store of (storeMap.target ?? [])) {
      for (let i = 0; i < tcins.length; i += BATCH) {
        const batch = tcins.slice(i, i + BATCH);
        try {
          const results = await checkTargetBatch(batch, store.id);
          const inStockCount = Object.values(results).filter(r => r.inStock).length;
          log.debug(`Target store ${store.name} batch ${Math.floor(i/BATCH)+1}: ${inStockCount} in stock`);
          restocksFound += await processTargetResults(results, targetProducts.slice(i, i + BATCH), store.id, store.name, store.address, discordConfig);
        } catch (err) {
          log.error(`Target store ${store.name} batch failed:`, err.message);
        }
        await sleepJitter(2000, 500);
      }
      await sleepJitter(3000, 1000);
    }
  }

  // --- Non-Target retailers (walmart, pokemoncenter, costco, samsclub, meijer) ---
  for (const product of products) {
    const { name, retailers, imageUrl = null, msrp = null } = product;

    for (const [retailerKey, cfg] of Object.entries(retailers)) {
      if (retailerKey === "target") continue; // handled above

      const displayName = DISPLAY[retailerKey] ?? retailerKey;

      if (ONLINE_ONLY_CHECKERS[retailerKey]) {
        try {
          const { inStock, price } = await ONLINE_ONLY_CHECKERS[retailerKey](cfg);
          const key = stateKey(name, retailerKey, "online");
          if (inStock) {
            stockCounts[key] = (stockCounts[key] ?? 0) + 1;
            if (stockCounts[key] === 2) {
              restocksFound++;
              const onlineLabel = { walmart: "Walmart.com", pokemoncenter: "Pokemon Center" };
              await sendRestockAlert({
                productName: name, retailer: displayName, retailerKey,
                storeName: onlineLabel[retailerKey] ?? `${displayName} Online`,
                storeAddress: cfg.url, storeId: "online",
                url: cfg.url, price, imageUrl, msrp, discordConfig
              });
            }
          } else {
            stockCounts[key] = 0;
          }
        } catch (err) {
          log.error(`Online check failed: ${name} at ${displayName}:`, err.message);
        }
        await sleepJitter(1500, 500);
      }

      const manualStores = storeMap[retailerKey] ?? [];
      if (manualStores.length && CHECKERS[retailerKey]) {
        for (const store of manualStores) {
          try {
            const { inStock, price } = await CHECKERS[retailerKey](cfg, store.id);
            const key = stateKey(name, retailerKey, store.id);
            if (inStock) {
              stockCounts[key] = (stockCounts[key] ?? 0) + 1;
              if (stockCounts[key] === 2) {
                restocksFound++;
                await sendRestockAlert({
                  productName: name, retailer: displayName, retailerKey,
                  storeName: store.name, storeAddress: store.address, storeId: store.id,
                  url: cfg.url, price, imageUrl, msrp, discordConfig
                });
              }
            } else {
              stockCounts[key] = 0;
            }
          } catch (err) {
            log.error(`In-store check failed: ${name} at ${store.name}:`, err.message);
          }
          await sleepJitter(500, 200);
        }
        await sleepJitter(1000, 500);
      }
    }
  }

  botStats.lastCheckTime = Date.now();
  log.info(`Check complete — ${restocksFound} restock(s) found`);
  if (restocksFound > 0) {
    await sendToLogs(discordConfig, `✅ Check complete — ${restocksFound} restock(s) found`);
  }
}

// --- Startup ---

log.info("🚀 Pokemon Restock Bot starting...");
log.info(`📍 ZIP: ${USER_ZIP} | Radius: ${SEARCH_RADIUS_MILES}mi | Poll: ${POLL_INTERVAL}s | Rediscover: every ${DISCOVER_INTERVAL_HRS}h`);

// Register slash commands and connect to Discord Gateway
await registerSlashCommands();
const discordConfig = await loadDiscordConfig();
startBot(botStats, discordConfig, buildStoreMap);

// Background init — runs after Gateway connection is established
(async () => {
  log.info("⏳ Starting product discovery in 30s...");
  await new Promise(r => setTimeout(r, 30 * 1000));
  await discoverProducts(getDiscordConfig());

  const storeMap = await buildStoreMap();
  botStats.nearbyStores = storeMap;

  const products = JSON.parse(readFileSync(PRODUCTS_FILE, "utf8"));
  const locatorRetailers = ["target", "walmart", "costco", "samsclub"];
  const locatorStoreCount = locatorRetailers.reduce((n, r) => n + (storeMap[r]?.length ?? 0), 0);
  const totalStoreCount = Object.values(storeMap).flat().length;

  log.info(`📦 Tracking ${products.length} product(s) — checking Target, Walmart, Costco, Sam's Club in-store + online`);
  if (locatorStoreCount > 0) log.info(`🏪 ${locatorStoreCount} nearby store(s) found via locator (${totalStoreCount} total)`);

  const cfg = getDiscordConfig();
  await sendToLogs(cfg, [
    `🚀 **Bot online** — polling every ${POLL_INTERVAL}s`,
    `📦 Tracking **${products.length}** product(s)`,
    `🌐 Monitoring: **Target** · **Walmart** · **Costco** · **Sam's Club** · **Pokemon Center**`,
    locatorStoreCount > 0
      ? `🏪 **${locatorStoreCount}** nearby store(s) found within **${SEARCH_RADIUS_MILES}mi** of ${USER_ZIP}`
      : "⚠️ No nearby stores found — check USER_ZIP and SEARCH_RADIUS_MILES"
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
