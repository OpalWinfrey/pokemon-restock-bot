import axios from "axios";
import { log } from "../logger.js";

export async function checkMeijer({ itemId, storeId }) {
  try {
    const { data } = await axios.get(
      `https://www.meijer.com/bin/meijer/product/inventory`,
      {
        params: { skuId: itemId, storeId },
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json"
        },
        timeout: 10000
      }
    );

    log.debug("Meijer response for", itemId, "at store", storeId, data);

    const inStock =
      data?.inventoryStatus === "IN_STOCK" ||
      data?.available === true ||
      data?.storeAvailability?.status === "IN_STOCK";

    const price = data?.price?.regularPrice ?? data?.regularPrice ?? null;

    return { inStock, price };
  } catch (err) {
    if (err.response?.status === 429) {
      log.warn("Meijer: rate limited — will retry next cycle");
    } else {
      log.error(`Meijer check failed for item ${itemId}:`, err.message);
    }
    return { inStock: false, price: null };
  }
}
