import axios from "axios";
import { log } from "../logger.js";

// GameStop uses Salesforce Commerce Cloud. The store availability endpoint
// accepts a product ID and store number and returns current inventory.
export async function checkGameStop({ productId, storeId }) {
  try {
    const { data } = await axios.get(
      "https://www.gamestop.com/on/demandware.store/Sites-gamestop-us-Site/en_US/Product-GetVariants",
      {
        params: { pid: productId, storeId, format: "ajax" },
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json, text/html"
        },
        timeout: 10000
      }
    );

    log.debug("GameStop response for", productId, "at store", storeId, data);

    // SFCC returns availability in different shapes depending on product type
    const availability =
      data?.product?.availability?.available ??
      data?.availability?.inStoreStock ??
      data?.inStoreAvailability ??
      null;

    const inStock = availability === true || availability === "IN_STOCK";
    const price = data?.product?.price?.sales?.value ?? data?.price ?? null;

    return { inStock, price };
  } catch (err) {
    if (err.response?.status === 429) {
      log.warn("GameStop: rate limited — will retry next cycle");
    } else {
      log.error(`GameStop check failed for product ${productId}:`, err.message);
    }
    return { inStock: false, price: null };
  }
}
