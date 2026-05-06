import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { log } from "./logger.js";
import { findNearbyStores } from "./locator.js";

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

/**
 * Discover nearby stores via store locator APIs, merge new entries into stores.json
 * (without duplicating existing ones), and return the full store map.
 *
 * @param {string} zip         - 5-digit ZIP code (from USER_ZIP env var)
 * @param {number} radiusMiles - search radius in miles
 * @returns {Promise<Object>}  - store map keyed by retailer
 */
export async function findAndSaveNearbyStores(zip, radiusMiles) {
  if (!zip) {
    log.warn("findAndSaveNearbyStores: USER_ZIP is not set — skipping locator");
    return buildManualStoreMap();
  }

  log.info(`Store locator: searching within ${radiusMiles}mi of ZIP ${zip}…`);

  let nearby;
  try {
    nearby = await findNearbyStores(zip, radiusMiles);
  } catch (err) {
    log.error("Store locator failed entirely:", err.message);
    return buildManualStoreMap();
  }

  // Load current stores.json so we can deduplicate
  const existing = getManualStores();

  let added = 0;
  // Merge each retailer's results
  for (const [retailer, storeList] of Object.entries(nearby)) {
    for (const store of storeList) {
      const id = String(store.id).trim();
      if (!id) continue;

      const alreadyExists = existing.some(
        s => s.retailer === retailer && String(s.storeId) === id
      );

      if (!alreadyExists) {
        existing.push({
          retailer,
          storeId: id,
          storeName: store.name,
          address: store.address ?? ""
        });
        added++;
        log.debug(`Store locator: added ${retailer} #${id} — ${store.name}`);
      }
    }
  }

  if (added > 0) {
    writeFileSync(STORES_FILE, JSON.stringify(existing, null, 2) + "\n");
    log.info(`Store locator: added ${added} new store(s) to stores.json`);
  } else {
    log.info("Store locator: no new stores found (all already in stores.json)");
  }

  // Re-build and return the full map from the updated stores.json
  return buildManualStoreMap();
}
