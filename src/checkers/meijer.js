import { browserFetch } from "../browser.js";
import { log } from "../logger.js";

const ORIGIN = "https://www.meijer.com";

export async function checkMeijer({ itemId, storeId }) {
  try {
    const params = new URLSearchParams({ skuId: itemId, storeId });

    const data = await browserFetch(
      ORIGIN,
      `https://www.meijer.com/bin/meijer/product/inventory?${params}`,
      { headers: { Origin: ORIGIN, Referer: ORIGIN } }
    );

    if (data?.__error) {
      log.warn(`Meijer: API error ${data.__error} for item ${itemId}`);
      return { inStock: false, price: null };
    }

    const inStock =
      data?.inventoryStatus === "IN_STOCK" ||
      data?.available === true ||
      data?.storeAvailability?.status === "IN_STOCK";
    const price = data?.price?.regularPrice ?? data?.regularPrice ?? null;

    log.debug(`Meijer item ${itemId} store ${storeId}: inStock=${inStock}`);
    return { inStock, price };
  } catch (err) {
    log.error(`Meijer check failed for item ${itemId}:`, err.message);
    return { inStock: false, price: null };
  }
}
