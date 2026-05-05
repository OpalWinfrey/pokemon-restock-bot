import axios from "axios";
import { log } from "../logger.js";

export async function checkCostco({ itemNumber, warehouseId }) {
  try {
    const { data } = await axios.get("https://www.costco.com/AjaxWarehousePickupAvailabilityView", {
      params: {
        storeId: "10301", catalogId: "10701", langId: "-1",
        productId: itemNumber, warehouseId
      },
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/json"
      },
      timeout: 10000
    });

    const body = typeof data === "string" ? data : JSON.stringify(data);
    log.debug("Costco response for item", itemNumber, body.slice(0, 300));

    const inStock = /in.?stock|add.to.cart|available/i.test(body) &&
                    !/out.of.stock|not.available|unavailable/i.test(body);

    return { inStock, price: null };
  } catch (err) {
    if (err.response?.status === 429) {
      log.warn("Costco: rate limited — will retry next cycle");
    } else {
      log.error(`Costco check failed for item ${itemNumber}:`, err.message, err.response?.data);
    }
    return { inStock: false, price: null };
  }
}
