import "dotenv/config";
import cron from "node-cron";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { getStoresNearZip } from "./stores.js";
import { discoverProducts } from "./discover.js";
import { checkTarget } from "./checkers/target.js";
import { checkWalmart } from "./checkers/walmart.js";
import { checkBestBuy } from "./checkers/bestbuy.js";
import { checkCostco } from "./checkers/costco.js";
import { checkWalgreens } from "./checkers/walgreens.js";
import { checkCVS } from "./checkers/cvs.js";
import { sendRestockAlert } from "./discord.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const PRODUCTS_FILE = join(__dir, "../config/products.json");

const USER_ZIP = process.env.USER_ZIP;
const SEARCH_RADIUS_MILES = parseInt(process.env.SEARCH_RADIUS_MILES || "20");
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_SECONDS || "60");
const DISCOVER_INTERVAL_HOURS = parseFloat(process.env.DISCOVER_INTERVAL_HOURS || "12");

if (!USER_ZIP) {
  console.error("❌ USER_ZIP is not set in .env — cannot find nearby stores without it.");
  process.exit(1);
}

// State key per product + retailer + store — only alert on the transition to in-stock
const previousState = {};
function stateKey(productName, retailer, storeId) {
  return `${productName}__${retailer}__${storeId}`;
}

const CHECKERS = {
  target:    (cfg, storeId) => checkTarget({ tcin: cfg.tcin, storeId }),
  walmart:   (cfg, storeId) => checkWalmart({ itemId: cfg.itemId, storeId }),
  bestbuy:   (cfg, storeId) => checkBestBuy({ sku: cfg.sku, storeId }),
  costco:    (cfg, storeId) => checkCostco({ itemNumber: cfg.itemNumber, warehouseId: storeId }),
  walgreens: (cfg, storeId) => checkWalgreens({ sku: cfg.sku, storeNum: storeId }),
  cvs:       (cfg, storeId) => checkCVS({ upc: cfg.upc, storeId })
};

const DISPLAY_NAMES = {
  target: "Target", walmart: "Walmart", bestbuy: "Best Buy",
  costco: "Costco", walgreens: "Walgreens", cvs: "CVS"
};

async function checkAll(nearbyStores) {
  console.log(`\n🔍 Checking stock... [${new Date().toLocaleTimeString()}]`);

  // Always read products fresh from disk so new discoveries are picked up automatically
  const products = JSON.parse(readFileSync(PRODUCTS_FILE, "utf8"));

  for (const product of products) {
    const { name, retailers } = product;

    for (const [retailerKey, cfg] of Object.entries(retailers)) {
      const stores = nearbyStores[retailerKey] ?? [];
      if (stores.length === 0) continue;

      const checker = CHECKERS[retailerKey];
      if (!checker) continue;

      const displayName = DISPLAY_NAMES[retailerKey] ?? retailerKey;

      for (const store of stores) {
        const { inStock, price } = await checker(cfg, store.id);
        const key = stateKey(name, retailerKey, store.id);
        const wasInStock = previousState[key] ?? false;

        if (inStock && !wasInStock) {
          console.log(`✅ RESTOCK: ${name} at ${displayName} — ${store.name}!`);
          await sendRestockAlert({ productName: name, retailer: displayName, storeName: store.name, storeId: store.id, url: cfg.url, price });
        } else if (!inStock) {
          console.log(`❌ Out of stock: ${name} at ${displayName} — ${store.name}`);
        } else {
          console.log(`✅ Still in stock: ${name} at ${displayName} — ${store.name} (no alert)`);
        }

        previousState[key] = inStock;
      }
    }
  }
}

// --- Startup ---

console.log("🚀 Pokemon Restock Bot starting...");
console.log(`📍 ZIP: ${USER_ZIP}  |  Radius: ${SEARCH_RADIUS_MILES} miles`);
console.log(`⏱  Polling every ${POLL_INTERVAL}s  |  Re-discovering products every ${DISCOVER_INTERVAL_HOURS}h`);

// Discover products and find nearby stores in parallel
await discoverProducts();
const nearbyStores = await getStoresNearZip(USER_ZIP, SEARCH_RADIUS_MILES);

const products = JSON.parse(readFileSync(PRODUCTS_FILE, "utf8"));
console.log(`📦 Tracking ${products.length} product(s) across ${Object.values(nearbyStores).flat().length} nearby stores`);

await checkAll(nearbyStores);

// Poll for stock changes
cron.schedule(`*/${POLL_INTERVAL} * * * * *`, () => checkAll(nearbyStores));

// Re-discover new products periodically
const discoverMs = DISCOVER_INTERVAL_HOURS * 60 * 60 * 1000;
setInterval(discoverProducts, discoverMs);
