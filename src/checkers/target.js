import { browserFetch } from "../browser.js";
import { log } from "../logger.js";

const ORIGIN = "https://www.target.com";
const API_KEY = "9f36aeafbe60771e321a7cc95a78140772ab3e96";
const BATCH_SIZE = 20;

function randomVisitorId() {
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16).toUpperCase()).join("");
}

// Fetch fulfillment data for up to BATCH_SIZE TCINs in one API call.
// Returns a map of tcin → { inStock, price, storeStatus }
export async function checkTargetBatch(tcins, storeId = null) {
  const zip = process.env.USER_ZIP ?? "45227";
  const params = new URLSearchParams({
    key: API_KEY,
    tcins: tcins.join(","),
    zip, state: "OH", channel: "WEB",
    visitor_id: randomVisitorId(),
    page: "/s/pokemon"
  });
  if (storeId) {
    params.set("store_id", storeId);
    params.set("pricing_store_id", storeId);
  }

  const data = await browserFetch(
    ORIGIN,
    `https://redsky.target.com/redsky_aggregations/v1/web/product_summary_with_fulfillment_v1?${params}`,
    { headers: { Origin: ORIGIN, Referer: `${ORIGIN}/s/pokemon` } }
  );

  if (data?.__error) {
    log.warn(`Target batch: API error ${data.__error} for ${tcins.length} TCINs`);
    return {};
  }

  const results = {};
  for (const product of data?.data?.product_summaries ?? []) {
    const tcin = String(product.tcin);
    const fulfillment = product.fulfillment ?? {};
    const price = product.price?.current_retail ?? product.price?.reg_retail ?? null;

    if (storeId) {
      const storeOptions = fulfillment.store_options ?? [];
      const opt = storeOptions.find(o => String(o.store?.store_id ?? "") === String(storeId)) ?? storeOptions[0] ?? null;
      const status = opt?.order_pickup?.availability_status ?? opt?.in_store_only?.availability_status ?? "";
      results[tcin] = { inStock: status === "IN_STOCK" || status === "AVAILABLE", price, status };
    } else {
      const status = fulfillment.shipping_options?.availability_status ?? "";
      results[tcin] = { inStock: status === "IN_STOCK", price, status };
    }
  }

  return results;
}

// Convenience single-product wrapper (used by legacy callers)
export async function checkTarget({ tcin, storeId = null }) {
  try {
    const results = await checkTargetBatch([tcin], storeId);
    const r = results[String(tcin)];
    if (!r) return { inStock: false, price: null };
    log.debug(`Target ${storeId ? `store ${storeId}` : "online"} TCIN ${tcin}: ${r.status}`);
    return { inStock: r.inStock, price: r.price, isOnline: !storeId };
  } catch (err) {
    log.error(`Target check failed for TCIN ${tcin}:`, err.message);
    return { inStock: false, price: null };
  }
}
