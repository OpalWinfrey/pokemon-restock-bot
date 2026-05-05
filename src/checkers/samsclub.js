import axios from "axios";
import { log } from "../logger.js";

// Sam's Club is Walmart-owned and uses a similar internal API structure.
export async function checkSamsClub({ itemId, clubId }) {
  try {
    const { data } = await axios.get(
      "https://www.samsclub.com/api/node/vivaldi/v2/products/search/product-detail",
      {
        params: { skuId: itemId, clubId },
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json"
        },
        timeout: 10000
      }
    );

    log.debug("Sam's Club response for", itemId, "at club", clubId, data);

    const payload = data?.payload ?? data;
    const inStock =
      payload?.availabilityStatus === "IN_STOCK" ||
      payload?.inventory?.status === "IN_STOCK" ||
      payload?.clubAvailability?.available === true;

    const price = payload?.prices?.finalPrice?.price ?? null;

    return { inStock, price };
  } catch (err) {
    if (err.response?.status === 429) {
      log.warn("Sam's Club: rate limited — will retry next cycle");
    } else {
      log.error(`Sam's Club check failed for item ${itemId}:`, err.message);
    }
    return { inStock: false, price: null };
  }
}
