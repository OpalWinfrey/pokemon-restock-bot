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
import { checkTarget }    from "./checkers/target.js";
import { checkWalmart }   from "./checkers/walmart.js";
import { checkBestBuy }   from "./checkers/bestbuy.js";
import { checkCostco }    from "./checkers/costco.js";
import { checkGameStop }  from "./checkers/gamestop.js";
import { checkSamsClub }  from "./checkers/samsclub.js";
import { checkMeijer }    from "./checkers/meijer.js";
import { checkWalgreens } from "./checkers/walgreens.js";
import { checkCVS }       from "./checkers/cvs.js";
import { sendRestockAlert, sendToLogs } from "./discord.js";
import { startServer, registerSlashCommands } from "./server.js";

validateEnv();

const __dir = dirname(fileURLToPath(import.meta.url));
const PRODUCTS_FILE = join(__dir, "../config/products.json");

const USER_ZIP              = process.env.USER_ZIP;
const SEARCH_RADIUS_MILES   = parseInt(process.env.SEARCH_RADIUS_MILES   || "20");
const POLL_INTERVAL         = parseInt(process.env.POLL_INTERVAL_SECONDS || "60");
const DISCOVER_INTERVAL_HRS = parseFloat(process.env.DISCOVER_INTERVAL_HOURS || "12");

export const botStats = { nearbyStores: {}, lastCheckTime: null };

const previousState = {};
function stateKey(productName, retailer, storeId) {
  return `${productName}__${retailer}__${storeId}`;
}

const CHECKERS = {
  target:    (cfg, id) => checkTarget({ tcin: cfg.tcin, storeId: id }),
  walmart:   (cfg, id) => checkWalmart({ itemId: cfg.itemId, storeId: id }),
  bestbuy:   (cfg, id) => checkBestBuy({ sku: cfg.sku, storeId: id }),
  costco:    (cfg, id) => checkCostco({ itemNumber: cfg.itemNumber, warehouseId: id }),
  gamestop:  (cfg, id) => checkGameStop({ productId: cfg.productId, storeId: id }),
  samsclub:  (cfg, id) => checkSamsClub({ itemId: cfg.itemId, clubId: id }),
  meijer:    (cfg, id) => checkMeijer({ itemId: cfg.itemId, storeId: id }),
  walgreens: (cfg, id) => checkWalgreens({ sku: cfg.sku, storeNum: id }),
  cvs:       (cfg, id) => checkCVS({ upc: cfg.upc, storeId: id })
};

const DISPLAY = {
  target: "Target", walmart: "Walmart", bestbuy: "Best Buy", costco: "Costco",
  gamestop: "GameStop", samsclub: "Sam's Club", meijer: "Meijer",
  walgreens: "Walgreens", cvs: "CVS"
};

async function buildStoreMap() {
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
    const { name, retailers, imageUrl = null, msrp = null } = product;

    for (const [retailerKey, cfg] of Object.entries(retailers)) {
      const stores = storeMap[retailerKey] ?? [];
      if (!stores.length) continue;

      const checker = CHECKERS[retailerKey];
      if (!checker) { log.warn(`No checker for "${retailerKey}" — skipping`); continue; }

      const displayName = DISPLAY[retailerKey] ?? retailerKey;

      for (const store of stores) {
        try {
          const { inStock, price } = await checker(cfg, store.id);
          const key = stateKey(name, retailerKey, store.id);
          const wasInStock = previousState[key] ?? false;

          if (inStock && !wasInStock) {
            log.info(`RESTOCK: ${name} at ${displayName} — ${store.name}`);
            restocksFound++;
            await sendRestockAlert({
              productName: name, retailer: displayName,
              storeName: store.name, storeAddress: store.address, storeId: store.id,
              url: cfg.url, price, imageUrl, msrp, discordConfig
            });
          } else {
            log.debug(`${inStock ? "In stock (no change)" : "Out of stock"}: ${name} at ${displayName} — ${store.name}`);
          }

          previousState[key] = inStock;
        } catch (err) {
          log.error(`Check failed: ${name} at ${displayName} store ${store.id}:`, err.message);
        }
      }
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

await registerSlashCommands();

const discordConfig = await loadDiscordConfig();

await discoverProducts();

const storeMap = await buildStoreMap();
botStats.nearbyStores = storeMap;

const products = JSON.parse(readFileSync(PRODUCTS_FILE, "utf8"));
const totalStores = Object.values(storeMap).flat().length;
log.info(`📦 Tracking ${products.length} product(s) across ${totalStores} store(s)`);

startServer(botStats, discordConfig);

await checkAll(storeMap, discordConfig);

cron.schedule(`*/${POLL_INTERVAL} * * * * *`, () => checkAll(storeMap, discordConfig));
setInterval(discoverProducts, DISCOVER_INTERVAL_HRS * 60 * 60 * 1000);
