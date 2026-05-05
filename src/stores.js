import axios from "axios";
import { log } from "./logger.js";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
};

function fmt(...parts) {
  return parts.filter(Boolean).join(", ");
}

async function findTargetStores(zip, radiusMiles) {
  const { data } = await axios.get("https://redsky.target.com/v3/stores/nearby", {
    params: { place: zip, within: radiusMiles, unit: "mile", limit: 20 },
    headers: HEADERS, timeout: 10000
  });
  return (data.locations ?? []).map(s => ({
    id: String(s.location_id),
    name: s.location_name,
    address: fmt(s.address?.address_line1, s.address?.city, s.address?.region)
  }));
}

async function findWalmartStores(zip, radiusMiles) {
  const { data } = await axios.get("https://www.walmart.com/store/ajax/nearbyStores", {
    params: { zipCode: zip, distance: radiusMiles },
    headers: { ...HEADERS, Accept: "application/json" }, timeout: 10000
  });
  const stores = data.payload?.storesMap ?? data.stores ?? [];
  return stores.map(s => ({
    id: String(s.id ?? s.storeId),
    name: s.displayName ?? s.name,
    address: fmt(s.address?.address, s.address?.city, s.address?.state)
  }));
}

async function findCostcoWarehouses(zip, radiusMiles) {
  const { data } = await axios.get("https://www.costco.com/AjaxWarehouseBrowseView", {
    params: {
      serviceType: "ALL", storeId: "10301", catalogId: "10701",
      langId: "-1", countryCode: "US", zip, radiusKm: Math.round(radiusMiles * 1.609)
    },
    headers: { ...HEADERS, Accept: "application/json, text/html" }, timeout: 10000
  });
  const warehouses = Array.isArray(data) ? data : data.warehouses ?? data.data ?? [];
  return warehouses.map(w => ({
    id: String(w.stlocID ?? w.id ?? w.warehouseNumber),
    name: w.displayName ?? w.name ?? w.stlocName,
    address: fmt(w.address1, w.city, w.state ?? w.stateCode)
  }));
}

async function findGameStopStores(zip, radiusMiles) {
  const { data } = await axios.get(
    "https://www.gamestop.com/on/demandware.store/Sites-gamestop-us-Site/en_US/Stores-FindStores",
    {
      params: { postalCode: zip, maxDistance: radiusMiles, format: "ajax" },
      headers: { ...HEADERS, Accept: "application/json" }, timeout: 10000
    }
  );
  const stores = data?.stores ?? data?.storesList ?? [];
  return stores.map(s => ({
    id: String(s.ID ?? s.id ?? s.storeId),
    name: s.name ?? `GameStop #${s.ID}`,
    address: fmt(s.address1, s.city, s.stateCode)
  }));
}

async function findSamsClubStores(zip, radiusMiles) {
  const { data } = await axios.get(
    "https://www.samsclub.com/api/node/vivaldi/v2/clubs/search",
    {
      params: { postalCode: zip, distance: radiusMiles },
      headers: { ...HEADERS, Accept: "application/json" }, timeout: 10000
    }
  );
  const clubs = data?.payload ?? data?.clubs ?? [];
  return clubs.map(s => ({
    id: String(s.id ?? s.clubId),
    name: s.name ?? `Sam's Club #${s.id}`,
    address: fmt(s.address?.address1, s.address?.city, s.address?.state)
  }));
}

async function findMeijerStores(zip, radiusMiles) {
  const { data } = await axios.get("https://www.meijer.com/bin/meijer/store/search", {
    params: { zipCode: zip, radius: radiusMiles, maxResults: 20 },
    headers: { ...HEADERS, Accept: "application/json" }, timeout: 10000
  });
  const stores = data?.stores ?? data?.results ?? [];
  return stores.map(s => ({
    id: String(s.storeNumber ?? s.id),
    name: s.storeName ?? s.name ?? `Meijer #${s.storeNumber}`,
    address: fmt(s.address, s.city, s.state)
  }));
}

async function findWalgreenStores(zip, radiusMiles) {
  const { data } = await axios.get("https://www.walgreens.com/locator/results.jsp", {
    params: { async: true, requesttype: "locatornearby", zip, radiusmiles: radiusMiles, maxResults: 20 },
    headers: { ...HEADERS, Accept: "application/json" }, timeout: 10000
  });
  const stores = data?.results ?? data?.stores ?? [];
  return stores.map(s => ({
    id: String(s.storeNumber ?? s.id),
    name: s.storeName ?? s.name,
    address: fmt(s.address?.line1, s.address?.city, s.address?.state)
  }));
}

async function findCVSStores(zip, radiusMiles) {
  const { data } = await axios.get("https://www.cvs.com/rest/bean/storeInfo/getNearByStores", {
    params: { location: zip, radius: radiusMiles, maxResults: 20 },
    headers: { ...HEADERS, Accept: "application/json" }, timeout: 10000
  });
  const stores = data?.storeList ?? data?.stores ?? [];
  return stores.map(s => ({
    id: String(s.storeId ?? s.id),
    name: `CVS #${s.storeId ?? s.id}`,
    address: fmt(s.addressLine, s.city, s.stateCode)
  }));
}

async function tryFind(retailer, fn) {
  try {
    const stores = await fn();
    log.info(`  📍 ${retailer}: found ${stores.length} store(s) nearby`);
    return stores;
  } catch (err) {
    log.warn(`  ${retailer}: store lookup failed — ${err.message}`);
    return [];
  }
}

export async function getStoresNearZip(zip, radiusMiles) {
  log.info(`\n🗺  Finding stores within ${radiusMiles} miles of ${zip}...`);
  const [target, walmart, costco, gamestop, samsclub, meijer, walgreens, cvs] =
    await Promise.all([
      tryFind("Target",     () => findTargetStores(zip, radiusMiles)),
      tryFind("Walmart",    () => findWalmartStores(zip, radiusMiles)),
      tryFind("Costco",     () => findCostcoWarehouses(zip, radiusMiles)),
      tryFind("GameStop",   () => findGameStopStores(zip, radiusMiles)),
      tryFind("Sam's Club", () => findSamsClubStores(zip, radiusMiles)),
      tryFind("Meijer",     () => findMeijerStores(zip, radiusMiles)),
      tryFind("Walgreens",  () => findWalgreenStores(zip, radiusMiles)),
      tryFind("CVS",        () => findCVSStores(zip, radiusMiles))
    ]);
  return { target, walmart, costco, gamestop, samsclub, meijer, walgreens, cvs };
}
