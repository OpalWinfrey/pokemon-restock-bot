import "dotenv/config";
import cron from "node-cron";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { validateEnv } from "./validate.js";
import { log } from "./logger.js";
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
import { sendRestockAlert } from "./discord.js";
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
  target:    (cfg, storeId) => checkTarget({ tcin: cfg.tcin, storeId }),
  walmart:   (cfg, storeId) => checkWalmart({ itemId: cfg.itemId, storeId }),
  bestbuy:   (cfg, storeId) => checkBestBuy({ sku: cfg.sku, storeId }),
  costco:    (cfg, storeId) => checkCostco({ itemNumber: cfg.itemNumber, warehouseId: storeId }),
  gamestop:  (cfg, storeId) => checkGameStop({ productId: cfg.productId, storeId }),
  samsclub:  (cfg, storeId) => checkSamsClub({ itemId: cfg.itemId, clubId: storeId }),
  meijer:    (cfg, storeId) => checkMeijer({ itemId: cfg.itemId, storeId }),
  walgreens: (cfg, storeId) => checkWalgreens({ sku: cfg.sku, storeNum: storeId }),
  cvs:       (cfg, storeId) => checkCVS({ upc: cfg.upc, storeId })
};

const DISPLAY_NAMES = {
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
      const existing = map[retailer] ?? [];
      const existingIds = new Set(existing.map(s => s.id));
      map[retailer] = [...existing, ...stores.filter(s => !existingIds.has(s.id))];
    }
  }

  return map;
}

async function checkAll(storeMap) {
  log.info(`Checking stock... [${new Date().toLocaleTimeString()}]`);
  const products = JSON.parse(readFileSync(PRODUCTS_FILE, "utf8"));

  for (const product of products) {
    const { name, retailers, imageUrl = null, msrp = null } = product;

    for (const [retailerKey, cfg] of Object.entries(retailers)) {
      const stores = storeMap[retailerKey] ?? [];
      if (stores.length === 0) continue;

      const checker = CHECKERS[retailerKey];
      if (!checker) {
        log.warn(`No checker implemented for retailer "${retailerKey}" — skipping`);
        continue;
      }

      const displayName = DISPLAY_NAMES[retailerKey] ?? retailerKey;

      for (const store of stores) {
        try {
          const { inStock, price } = await checker(cfg, store.id);
          const key = stateKey(name, retailerKey, store.id);
          const wasInStock = previousState[key] ?? false;

          if (inStock && !wasInStock) {
            log.info(`RESTOCK: ${name} at ${displayName} — ${store.name}`);
            await sendRestockAlert({
              productName: name, retailer: displayName,
              storeName: store.name, storeAddress: store.address, storeId: store.id,
              url: cfg.url, price, imageUrl, msrp
            });
          } else if (!inStock) {
            log.debug(`Out of stock: ${name} at ${displayName} — ${store.name}`);
          } else {
            log.debug(`Still in stock: ${name} at ${displayName} — ${store.name} (no alert)`);
          }

          previousState[key] = inStock;
        } catch (err) {
          // Isolated: one failed check never kills the rest of the loop
          log.error(`Unhandled error checking ${name} at ${displayName} store ${store.id}:`, err.message);
        }
      }
    }
  }

  botStats.lastCheckTime = Date.now();
}

// --- Startup ---

log.info("🚀 Pokemon Restock Bot starting...");
log.info(`📍 Default ZIP: ${USER_ZIP}  |  Radius: ${SEARCH_RADIUS_MILES} miles`);
log.info(`⏱  Polling every ${POLL_INTERVAL}s  |  Re-discovering every ${DISCOVER_INTERVAL_HRS}h`);

await registerSlashCommands();
await discoverProducts();

const storeMap = await buildStoreMap();
botStats.nearbyStores = storeMap;

const totalStores = Object.values(storeMap).flat().length;
const products = JSON.parse(readFileSync(PRODUCTS_FILE, "utf8"));
log.info(`📦 Tracking ${products.length} product(s) across ${totalStores} nearby stores`);

startServer(botStats);

await checkAll(storeMap);

cron.schedule(`*/${POLL_INTERVAL} * * * * *`, () => checkAll(storeMap));
setInterval(discoverProducts, DISCOVER_INTERVAL_HRS * 60 * 60 * 1000);
