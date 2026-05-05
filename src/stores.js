import { log } from "./logger.js";

// All retailer store locator APIs block requests from cloud/datacenter IPs.
// We no longer attempt automated store lookup. Instead:
//   - Target and Walmart are checked for online (ship-to-address) stock
//   - Pokemon Center is checked for online drops
//   - Users can add their own store IDs via /addstore for in-store alerts
export function getStoresNearZip() {
  log.info("  ℹ️  Store locator skipped — all retailer APIs block cloud IPs. Checking online stock only.");
  return { target: [], walmart: [], costco: [], samsclub: [], meijer: [], walgreens: [], cvs: [] };
}

// Stores added manually by users via /addstore command
// Stored in config/stores.json as { retailer, storeId, storeName, zip }
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
export const STORES_FILE = join(__dir, "../config/stores.json");

export function getManualStores() {
  try {
    return JSON.parse(readFileSync(STORES_FILE, "utf8"));
  } catch {
    return [];
  }
}

export function buildManualStoreMap() {
  const stores = getManualStores();
  const map = {};
  for (const s of stores) {
    if (!map[s.retailer]) map[s.retailer] = [];
    map[s.retailer].push({ id: String(s.storeId), name: s.storeName, address: s.address ?? "" });
  }
  return map;
}
