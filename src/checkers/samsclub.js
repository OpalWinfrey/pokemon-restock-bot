import { browserFetch } from "../browser.js";
import { log } from "../logger.js";

const ORIGIN = "https://www.samsclub.com";

export async function checkSamsClub({ itemId, clubId }) {
  try {
    const params = new URLSearchParams({ skuId: itemId, clubId });

    const data = await browserFetch(
      ORIGIN,
      `https://www.samsclub.com/api/node/vivaldi/v2/products/search/product-detail?${params}`,
      { headers: { Origin: ORIGIN, Referer: ORIGIN } }
    );

    if (data?.__error) {
      log.warn(`Sam's Club: API error ${data.__error} for item ${itemId}`);
      return { inStock: false, price: null };
    }

    const payload = data?.payload ?? data;
    const inStock =
      payload?.availabilityStatus === "IN_STOCK" ||
      payload?.inventory?.status === "IN_STOCK" ||
      payload?.clubAvailability?.available === true;
    const price = payload?.prices?.finalPrice?.price ?? null;

    log.debug(`Sam's Club item ${itemId} club ${clubId}: inStock=${inStock}`);
    return { inStock, price };
  } catch (err) {
    log.error(`Sam's Club check failed for item ${itemId}:`, err.message);
    return { inStock: false, price: null };
  }
}
