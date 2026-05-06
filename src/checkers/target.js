import { browserFetch } from "../browser.js";
import { log } from "../logger.js";

const ORIGIN = "https://www.target.com";

export async function checkTarget({ tcin, storeId = null }) {
  try {
    const zip = process.env.USER_ZIP ?? "45227";
    const params = new URLSearchParams({
      key: "9f36aeafbe60771e321a7cc95a78140772ab3e96",
      tcins: tcin, zip, state: "OH", channel: "WEB",
      visitor_id: "019DFAA0C27F0200803CEDE2427494BD",
      page: `/p/A-${tcin}`
    });
    if (storeId) {
      params.set("store_id", storeId);
      params.set("pricing_store_id", storeId);
    }

    const data = await browserFetch(
      ORIGIN,
      `https://redsky.target.com/redsky_aggregations/v1/web/product_summary_with_fulfillment_v1?${params}`,
      { headers: { Origin: ORIGIN, Referer: `${ORIGIN}/p/A-${tcin}` } }
    );

    if (data?.__error) {
      log.warn(`Target: API error ${data.__error} for TCIN ${tcin}`);
      return { inStock: false, price: null };
    }

    const product = data?.data?.product_summaries?.[0] ?? null;
    if (!product) return { inStock: false, price: null };

    const fulfillment = product.fulfillment ?? {};
    const price = product.price?.current_retail ?? product.price?.reg_retail ?? null;

    if (storeId) {
      const storeOptions = fulfillment.store_options ?? [];
      const opt = storeOptions.find(o => String(o.store?.store_id ?? "") === String(storeId)) ?? storeOptions[0] ?? null;
      const status = opt?.order_pickup?.availability_status ?? opt?.in_store_only?.availability_status ?? "";
      const inStock = status === "IN_STOCK" || status === "AVAILABLE";
      log.debug(`Target in-store TCIN ${tcin} store ${storeId}: ${status}`);
      return { inStock, price, isOnline: false };
    } else {
      const status = fulfillment.shipping_options?.availability_status ?? "";
      const inStock = status === "IN_STOCK";
      log.debug(`Target online TCIN ${tcin}: ${status}`);
      return { inStock, price, isOnline: true };
    }
  } catch (err) {
    log.error(`Target check failed for TCIN ${tcin}:`, err.message);
    return { inStock: false, price: null };
  }
}
