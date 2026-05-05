import axios from "axios";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
};

async function findTargetStores(zip, radiusMiles) {
  const { data } = await axios.get("https://redsky.target.com/v3/stores/nearby", {
    params: { place: zip, within: radiusMiles, unit: "mile", limit: 20 },
    headers: HEADERS,
    timeout: 10000
  });
  return (data.locations ?? []).map(s => ({ id: String(s.location_id), name: s.location_name }));
}

async function findWalmartStores(zip, radiusMiles) {
  const { data } = await axios.get("https://www.walmart.com/store/ajax/nearbyStores", {
    params: { zipCode: zip, distance: radiusMiles },
    headers: { ...HEADERS, Accept: "application/json" },
    timeout: 10000
  });
  const stores = data.payload?.storesMap ?? data.stores ?? [];
  return stores.map(s => ({ id: String(s.id ?? s.storeId), name: s.displayName ?? s.name }));
}

async function findBestBuyStores(zip, radiusMiles) {
  const apiKey = process.env.BESTBUY_API_KEY;
  if (!apiKey) return [];

  const { data } = await axios.get(
    `https://api.bestbuy.com/v1/stores(area(${zip},${radiusMiles}))`,
    {
      params: { apiKey, show: "storeId,name,city,distance", format: "json" },
      timeout: 10000
    }
  );
  return (data.stores ?? []).map(s => ({ id: String(s.storeId), name: `${s.name} (${s.city})` }));
}

async function findCostcoWarehouses(zip, radiusMiles) {
  const radiusKm = Math.round(radiusMiles * 1.609);
  const { data } = await axios.get("https://www.costco.com/AjaxWarehouseBrowseView", {
    params: {
      serviceType: "ALL",
      storeId: "10301",
      catalogId: "10701",
      langId: "-1",
      countryCode: "US",
      zip,
      radiusKm
    },
    headers: { ...HEADERS, Accept: "application/json, text/html" },
    timeout: 10000
  });

  // Costco returns JSON or embedded data depending on endpoint version
  const warehouses = Array.isArray(data) ? data : data.warehouses ?? data.data ?? [];
  return warehouses.map(w => ({
    id: String(w.stlocID ?? w.id ?? w.warehouseNumber),
    name: w.displayName ?? w.name ?? w.stlocName
  }));
}

async function findWalgreenStores(zip, radiusMiles) {
  const { data } = await axios.get("https://www.walgreens.com/locator/results.jsp", {
    params: {
      async: true,
      requesttype: "locatornearby",
      zip,
      radiusmiles: radiusMiles,
      maxResults: 20
    },
    headers: { ...HEADERS, Accept: "application/json" },
    timeout: 10000
  });
  const stores = data?.results ?? data?.stores ?? [];
  return stores.map(s => ({ id: String(s.storeNumber ?? s.id), name: s.storeName ?? s.name }));
}

async function findCVSStores(zip, radiusMiles) {
  const { data } = await axios.get("https://www.cvs.com/rest/bean/storeInfo/getNearByStores", {
    params: { location: zip, radius: radiusMiles, maxResults: 20 },
    headers: { ...HEADERS, Accept: "application/json" },
    timeout: 10000
  });
  const stores = data?.storeList ?? data?.stores ?? [];
  return stores.map(s => ({
    id: String(s.storeId ?? s.id),
    name: `CVS #${s.storeId ?? s.id}${s.city ? ` (${s.city})` : ""}`
  }));
}

async function tryFind(retailer, fn) {
  try {
    const stores = await fn();
    console.log(`  📍 ${retailer}: found ${stores.length} store(s) nearby`);
    return stores;
  } catch (err) {
    console.warn(`  ⚠️  ${retailer}: store lookup failed — ${err.message}`);
    return [];
  }
}

export async function getStoresNearZip(zip, radiusMiles) {
  console.log(`\n🗺  Finding stores within ${radiusMiles} miles of ${zip}...`);

  const [target, walmart, bestbuy, costco, walgreens, cvs] = await Promise.all([
    tryFind("Target", () => findTargetStores(zip, radiusMiles)),
    tryFind("Walmart", () => findWalmartStores(zip, radiusMiles)),
    tryFind("Best Buy", () => findBestBuyStores(zip, radiusMiles)),
    tryFind("Costco", () => findCostcoWarehouses(zip, radiusMiles)),
    tryFind("Walgreens", () => findWalgreenStores(zip, radiusMiles)),
    tryFind("CVS", () => findCVSStores(zip, radiusMiles))
  ]);

  return { target, walmart, bestbuy, costco, walgreens, cvs };
}
