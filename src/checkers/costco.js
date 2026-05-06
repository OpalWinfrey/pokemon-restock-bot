import { browserFetch } from "../browser.js";
import { log } from "../logger.js";

const ORIGIN = "https://www.costco.com";

export async function checkCostco({ itemNumber, warehouseId }) {
  try {
    const params = new URLSearchParams({
      storeId: "10301", catalogId: "10701", langId: "-1",
      productId: itemNumber, warehouseId
    });

    const data = await browserFetch(
      ORIGIN,
      `https://www.costco.com/AjaxWarehousePickupAvailabilityView?${params}`,
      { headers: { Origin: ORIGIN, Referer: ORIGIN } }
    );

    if (data?.__error) {
      log.warn(`Costco: API error ${data.__error} for item ${itemNumber}`);
      return { inStock: false, price: null };
    }

    const body = typeof data === "string" ? data : JSON.stringify(data);
    const inStock = /in.?stock|add.to.cart|available/i.test(body) &&
                    !/out.of.stock|not.available|unavailable/i.test(body);
    const price = data?.price ?? null;

    log.debug(`Costco item ${itemNumber} warehouse ${warehouseId}: inStock=${inStock}`);
    return { inStock, price };
  } catch (err) {
    log.error(`Costco check failed for item ${itemNumber}:`, err.message);
    return { inStock: false, price: null };
  }
}
