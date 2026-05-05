import "dotenv/config";
import cron from "node-cron";
import { products } from "../config/products.js";
import { checkTarget } from "./checkers/target.js";
import { checkWalmart } from "./checkers/walmart.js";
import { checkBestBuy } from "./checkers/bestbuy.js";
import { checkCostco } from "./checkers/costco.js";
import { sendRestockAlert } from "./discord.js";

// In-memory state to track what was previously in stock
// Prevents spamming alerts for the same restock
const previousState = {};

const TARGET_STORE_ID = process.env.TARGET_STORE_ID;
const WALMART_STORE_ID = process.env.WALMART_STORE_ID;
const BESTBUY_STORE_ID = process.env.BESTBUY_STORE_ID;
const COSTCO_WAREHOUSE_ID = process.env.COSTCO_WAREHOUSE_ID;
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_SECONDS || "60");

function stateKey(productName, retailer) {
  return `${productName}__${retailer}`;
}

async function checkRetailer({ name, retailer, check, storeId, url }) {
  const { inStock, price } = await check();
  const key = stateKey(name, retailer);
  const wasInStock = previousState[key] ?? false;

  if (inStock && !wasInStock) {
    console.log(`✅ RESTOCK: ${name} at ${retailer}!`);
    await sendRestockAlert({ productName: name, retailer, storeId, url, price });
  } else if (!inStock) {
    console.log(`❌ Out of stock: ${name} at ${retailer}`);
  } else {
    console.log(`✅ Still in stock: ${name} at ${retailer} (no new alert sent)`);
  }

  previousState[key] = inStock;
}

async function checkAll() {
  console.log(`\n🔍 Checking stock... [${new Date().toLocaleTimeString()}]`);

  for (const product of products) {
    const { name, retailers } = product;

    if (retailers.target && TARGET_STORE_ID) {
      await checkRetailer({
        name,
        retailer: "Target",
        check: () => checkTarget({ tcin: retailers.target.tcin, storeId: TARGET_STORE_ID }),
        storeId: TARGET_STORE_ID,
        url: retailers.target.url
      });
    }

    if (retailers.walmart && WALMART_STORE_ID) {
      await checkRetailer({
        name,
        retailer: "Walmart",
        check: () => checkWalmart({ itemId: retailers.walmart.itemId, storeId: WALMART_STORE_ID }),
        storeId: WALMART_STORE_ID,
        url: retailers.walmart.url
      });
    }

    if (retailers.bestbuy && BESTBUY_STORE_ID) {
      await checkRetailer({
        name,
        retailer: "Best Buy",
        check: () => checkBestBuy({ sku: retailers.bestbuy.sku, storeId: BESTBUY_STORE_ID }),
        storeId: BESTBUY_STORE_ID,
        url: retailers.bestbuy.url
      });
    }

    if (retailers.costco && COSTCO_WAREHOUSE_ID) {
      await checkRetailer({
        name,
        retailer: "Costco",
        check: () => checkCostco({ itemNumber: retailers.costco.itemNumber, warehouseId: COSTCO_WAREHOUSE_ID }),
        storeId: COSTCO_WAREHOUSE_ID,
        url: retailers.costco.url
      });
    }
  }
}

console.log("🚀 Pokemon Restock Bot starting...");
console.log(`📦 Tracking ${products.length} product(s)`);
console.log(`⏱  Polling every ${POLL_INTERVAL} seconds`);
console.log(`🎯 Target Store ID: ${TARGET_STORE_ID || "NOT SET"}`);
console.log(`🛒 Walmart Store ID: ${WALMART_STORE_ID || "NOT SET"}`);
console.log(`💙 Best Buy Store ID: ${BESTBUY_STORE_ID || "NOT SET"}`);
console.log(`🏪 Costco Warehouse ID: ${COSTCO_WAREHOUSE_ID || "NOT SET"}`);

await checkAll();

cron.schedule(`*/${POLL_INTERVAL} * * * * *`, checkAll);
