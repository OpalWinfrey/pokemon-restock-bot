// Store locator — finds nearby physical stores for each supported retailer.
// All retailer APIs work from residential IPs; they block datacenter IPs.
import axios from "axios";
import { apiHeaders } from "./http.js";
import { log } from "./logger.js";

const TIMEOUT = 10000;

// ---------------------------------------------------------------------------
// Target — redsky nearby-stores API
// ---------------------------------------------------------------------------
async function findTargetStores(zip, radiusMiles) {
  try {
    const { data } = await axios.get("https://redsky.target.com/v3/stores/nearby", {
      params: {
        place: zip,
        limit: 10,
        within: radiusMiles,
        unit: "mile",
        key: "9f36aeafbe60771e321a7cc95a78140772ab3e96"
      },
      headers: apiHeaders({ Referer: "https://www.target.com/" }),
      timeout: TIMEOUT
    });

    // Response shape: data[] where each element has store details in various sub-objects.
    // Primary store is in data[0]; nearby_stores[] has the rest.
    const stores = [];

    const items = Array.isArray(data?.data) ? data.data : [];
    for (const item of items) {
      // Each element may be a store object directly OR have a nearby_stores array
      const candidates = [];

      // The root item itself may be a store
      if (item.store_id || item.location_id) candidates.push(item);

      // nearby_stores array within the item
      if (Array.isArray(item.nearby_stores)) {
        candidates.push(...item.nearby_stores);
      }

      for (const s of candidates) {
        const id = String(s.store_id ?? s.location_id ?? "").trim();
        if (!id) continue;

        const addr = s.store_address?.formatted_str
          ?? s.location_address?.formatted_str
          ?? [s.address?.address_line1, s.address?.city, s.address?.state].filter(Boolean).join(", ")
          ?? "";

        const name = s.store_name ?? s.location_name ?? `Target #${id}`;

        // Deduplicate by id
        if (!stores.find(x => x.id === id)) {
          stores.push({ id, name, address: addr });
        }
      }
    }

    log.info(`Target locator: found ${stores.length} store(s) near ${zip}`);
    return stores;
  } catch (err) {
    log.warn(`Target locator failed for ZIP ${zip}: ${err.message}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Walmart — store/finder/view endpoint
// ---------------------------------------------------------------------------
async function findWalmartStores(zip, radiusMiles) {
  try {
    const { data } = await axios.get("https://www.walmart.com/store/finder/view", {
      params: {
        location: zip,
        distance: radiusMiles,
        limit: 10
      },
      headers: apiHeaders({
        Referer: "https://www.walmart.com/store/finder",
        "sec-fetch-site": "same-origin"
      }),
      timeout: TIMEOUT
    });

    // The endpoint returns JSON; shape can be { payload: { storesData: { stores: [] } } }
    // or variations. Walk common paths.
    const raw = typeof data === "string" ? JSON.parse(data) : data;

    const storeList =
      raw?.payload?.storesData?.stores ??
      raw?.storesData?.stores ??
      raw?.stores ??
      (Array.isArray(raw) ? raw : []);

    const stores = storeList.map(s => {
      const id = String(s.id ?? s.storeId ?? s.store_id ?? "").trim();
      const name = s.displayName ?? s.storeName ?? s.name ?? `Walmart #${id}`;
      const addr = [
        s.address?.address ?? s.address?.addressLineOne ?? s.addressLineOne ?? "",
        s.address?.city ?? s.city ?? "",
        s.address?.state ?? s.state ?? ""
      ].filter(Boolean).join(", ");

      return { id, name, address: addr };
    }).filter(s => s.id);

    log.info(`Walmart locator: found ${stores.length} store(s) near ${zip}`);
    return stores;
  } catch (err) {
    log.warn(`Walmart locator failed for ZIP ${zip}: ${err.message}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Costco — AjaxWarehouseSearchByGeolocationView
// ---------------------------------------------------------------------------
async function findCostcoStores(zip, radiusMiles) {
  try {
    const { data } = await axios.get("https://www.costco.com/AjaxWarehouseSearchByGeolocationView", {
      params: {
        zipCode: zip,
        countryCode: "US",
        nearWarehouse: "",
        selectedWarehouse: "",
        radius: radiusMiles
      },
      headers: apiHeaders({ Referer: "https://www.costco.com/" }),
      timeout: TIMEOUT
    });

    const raw = typeof data === "string" ? JSON.parse(data) : data;
    const list = raw?.warehouseList ?? raw?.data?.warehouseList ?? [];

    const stores = list.map(w => {
      const id = String(w.warehouseId ?? w.id ?? "").trim();
      const name = w.displayName ?? w.name ?? `Costco #${id}`;
      const address = [
        w.address1 ?? w.addressLine1 ?? "",
        w.city ?? "",
        w.state ?? ""
      ].filter(Boolean).join(", ");

      return { id, name, address };
    }).filter(s => s.id);

    log.info(`Costco locator: found ${stores.length} warehouse(s) near ${zip}`);
    return stores;
  } catch (err) {
    log.warn(`Costco locator failed for ZIP ${zip}: ${err.message}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Sam's Club — vivaldi/v2/clubs/search
// ---------------------------------------------------------------------------
async function findSamsClubStores(zip, radiusMiles) {
  try {
    const { data } = await axios.get("https://www.samsclub.com/api/node/vivaldi/v2/clubs/search", {
      params: {
        postalCode: zip,
        distance: radiusMiles
      },
      headers: apiHeaders({ Referer: "https://www.samsclub.com/club-finder" }),
      timeout: TIMEOUT
    });

    const raw = typeof data === "string" ? JSON.parse(data) : data;

    // Shape: { payload: { clubs: [] } } or { clubs: [] } or []
    const list =
      raw?.payload?.clubs ??
      raw?.clubs ??
      (Array.isArray(raw?.payload) ? raw.payload : null) ??
      (Array.isArray(raw) ? raw : []);

    const stores = list.map(c => {
      const id = String(c.id ?? c.clubId ?? c.club_id ?? "").trim();
      const name = c.name ?? c.displayName ?? `Sam's Club #${id}`;
      const address = [
        c.address?.address1 ?? c.address1 ?? c.addressLine1 ?? "",
        c.address?.city ?? c.city ?? "",
        c.address?.state ?? c.state ?? ""
      ].filter(Boolean).join(", ");

      return { id, name, address };
    }).filter(s => s.id);

    log.info(`Sam's Club locator: found ${stores.length} club(s) near ${zip}`);
    return stores;
  } catch (err) {
    log.warn(`Sam's Club locator failed for ZIP ${zip}: ${err.message}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Find nearby stores for all supported retailers.
 *
 * @param {string} zip          - 5-digit ZIP code
 * @param {number} radiusMiles  - search radius in miles
 * @returns {Promise<{ target: object[], walmart: object[], costco: object[], samsclub: object[] }>}
 *          Each store object: { id: string, name: string, address: string }
 */
export async function findNearbyStores(zip, radiusMiles) {
  // Run all four in parallel; each handles its own errors and returns []
  const [target, walmart, costco, samsclub] = await Promise.all([
    findTargetStores(zip, radiusMiles),
    findWalmartStores(zip, radiusMiles),
    findCostcoStores(zip, radiusMiles),
    findSamsClubStores(zip, radiusMiles)
  ]);

  return { target, walmart, costco, samsclub };
}
