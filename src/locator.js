import { browserFetch } from "./browser.js";
import { log } from "./logger.js";

async function findTargetStores(zip, radiusMiles) {
  try {
    const params = new URLSearchParams({
      key: "9f36aeafbe60771e321a7cc95a78140772ab3e96",
      zipcode: zip, limit: 10, radius: radiusMiles
    });
    const data = await browserFetch(
      "https://www.target.com",
      `https://api.target.com/location_fulfillment_aggregations/v1/preferred_stores?${params}`,
      { headers: { Origin: "https://www.target.com" } }
    );
    if (data?.__error) { log.warn(`Target locator: ${data.__error}`); return []; }

    const list = data?.preferred_stores ?? data?.locations ?? data?.stores ?? data?.data ?? [];
    const stores = list.map(s => ({
      id: String(s.location_id ?? s.store_id ?? s.id ?? "").trim(),
      name: s.location_names?.[0]?.name ?? s.location_name ?? s.store_name ?? s.name ?? "",
      address: s.formatted_address ?? s.store_address?.formatted_str ?? [s.address?.address_line1, s.address?.city, s.address?.state].filter(Boolean).join(", ") ?? ""
    })).filter(s => s.id);
    log.info(`Target locator: ${stores.length} store(s) near ${zip}`);
    return stores;
  } catch (err) {
    log.warn(`Target locator failed: ${err.message}`);
    return [];
  }
}

async function findWalmartStores(zip, radiusMiles) {
  try {
    const params = new URLSearchParams({ location: zip, distance: radiusMiles, limit: 10 });
    const data = await browserFetch(
      "https://www.walmart.com",
      `https://www.walmart.com/store/finder/view?${params}`,
      { headers: { Origin: "https://www.walmart.com", Referer: "https://www.walmart.com/store/finder" } }
    );
    if (data?.__error) { log.warn(`Walmart locator: ${data.__error}`); return []; }

    const list = data?.payload?.storesData?.stores ?? data?.storesData?.stores ?? data?.stores ?? (Array.isArray(data) ? data : []);
    const stores = list.map(s => ({
      id: String(s.id ?? s.storeId ?? "").trim(),
      name: s.displayName ?? s.storeName ?? s.name ?? "",
      address: [s.address?.address ?? s.addressLineOne ?? "", s.address?.city ?? s.city ?? "", s.address?.state ?? s.state ?? ""].filter(Boolean).join(", ")
    })).filter(s => s.id);
    log.info(`Walmart locator: ${stores.length} store(s) near ${zip}`);
    return stores;
  } catch (err) {
    log.warn(`Walmart locator failed: ${err.message}`);
    return [];
  }
}

async function findCostcoStores(zip, radiusMiles) {
  try {
    const params = new URLSearchParams({ zipCode: zip, countryCode: "US", nearWarehouse: "", selectedWarehouse: "", radius: radiusMiles });
    const data = await browserFetch(
      "https://www.costco.com",
      `https://www.costco.com/AjaxWarehouseSearchByGeolocationView?${params}`,
      { headers: { Origin: "https://www.costco.com" } }
    );
    if (data?.__error) { log.warn(`Costco locator: ${data.__error}`); return []; }

    const list = data?.warehouseList ?? data?.data?.warehouseList ?? [];
    const stores = list.map(w => ({
      id: String(w.warehouseId ?? w.id ?? "").trim(),
      name: w.displayName ?? w.name ?? "",
      address: [w.address1 ?? "", w.city ?? "", w.state ?? ""].filter(Boolean).join(", ")
    })).filter(s => s.id);
    log.info(`Costco locator: ${stores.length} warehouse(s) near ${zip}`);
    return stores;
  } catch (err) {
    log.warn(`Costco locator failed: ${err.message}`);
    return [];
  }
}

async function findSamsClubStores(zip, radiusMiles) {
  try {
    const params = new URLSearchParams({ postalCode: zip, distance: radiusMiles });
    const data = await browserFetch(
      "https://www.samsclub.com",
      `https://www.samsclub.com/api/node/vivaldi/v2/clubs/search?${params}`,
      { headers: { Origin: "https://www.samsclub.com" } }
    );
    if (data?.__error) { log.warn(`Sam's Club locator: ${data.__error}`); return []; }

    const list = data?.payload?.clubs ?? data?.clubs ?? (Array.isArray(data) ? data : []);
    const stores = list.map(c => ({
      id: String(c.id ?? c.clubId ?? "").trim(),
      name: c.name ?? c.displayName ?? "",
      address: [c.address?.address1 ?? c.address1 ?? "", c.address?.city ?? c.city ?? "", c.address?.state ?? c.state ?? ""].filter(Boolean).join(", ")
    })).filter(s => s.id);
    log.info(`Sam's Club locator: ${stores.length} club(s) near ${zip}`);
    return stores;
  } catch (err) {
    log.warn(`Sam's Club locator failed: ${err.message}`);
    return [];
  }
}

export async function findNearbyStores(zip, radiusMiles) {
  const [target, walmart, costco, samsclub] = await Promise.all([
    findTargetStores(zip, radiusMiles),
    findWalmartStores(zip, radiusMiles),
    findCostcoStores(zip, radiusMiles),
    findSamsClubStores(zip, radiusMiles)
  ]);
  return { target, walmart, costco, samsclub };
}
