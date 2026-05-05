import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { log } from "./logger.js";

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

// Returns { added: true } or { added: false, reason } if duplicate
export function addManualStore({ retailer, storeId, storeName, address = "" }) {
  const stores = getManualStores();
  const id = String(storeId);
  const existing = stores.find(s => s.retailer === retailer && String(s.storeId) === id);
  if (existing) return { added: false, reason: `${existing.storeName} is already in the list.` };
  stores.push({ retailer, storeId: id, storeName, address });
  writeFileSync(STORES_FILE, JSON.stringify(stores, null, 2) + "\n");
  log.info(`Manual store added: ${storeName} (${retailer} #${id})`);
  return { added: true };
}

export function removeManualStore({ retailer, storeId }) {
  const stores = getManualStores();
  const id = String(storeId);
  const before = stores.length;
  const filtered = stores.filter(s => !(s.retailer === retailer && String(s.storeId) === id));
  if (filtered.length === before) return { removed: false };
  writeFileSync(STORES_FILE, JSON.stringify(filtered, null, 2) + "\n");
  return { removed: true };
}
