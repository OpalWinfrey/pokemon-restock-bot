import { apiHeaders } from "../http.js";
import axios from "axios";
import { log } from "../logger.js";

export async function checkWalmart({ itemId, storeId }) {
  try {
    const { data } = await axios.get(
      "https://www.walmart.com/store/ajax/selected-item/details",
      {
        params: { itemId, storeId },
        headers: apiHeaders({ Referer: "https://www.walmart.com/" }),
        timeout: 10000
      }
    );

    log.debug("Walmart response for item", itemId, data);

    if (!data) {
      log.warn(`Walmart: no data for item ${itemId}`);
      return { inStock: false, price: null };
    }

    const availabilityStatus =
      data.availabilityStatus ||
      data.store?.availability?.availabilityStatus ||
      null;

    const inStock = availabilityStatus === "IN_STOCK";
    const price = data.priceInfo?.currentPrice?.price ?? null;

    return { inStock, price };
  } catch (err) {
    if (err.response?.status === 429) {
      log.warn("Walmart: rate limited — will retry next cycle");
    } else {
      log.error(`Walmart check failed for item ${itemId}:`, err.message, err.response?.data);
    }
    return { inStock: false, price: null };
  }
}
