import { apiHeaders } from "../http.js";
import axios from "axios";
import { log } from "../logger.js";

export async function checkWalgreens({ sku, storeNum }) {
  try {
    const { data } = await axios.post(
      "https://www.walgreens.com/store/store/details/inStore/storeProductAvailability",
      { storeNum, skuId: sku },
      {
        headers: apiHeaders({ "Content-Type": "application/json", Referer: "https://www.walgreens.com/" }),
        timeout: 10000
      }
    );

    log.debug("Walgreens response for SKU", sku, data);
    const inStock = data?.availability === "IN_STOCK" || data?.inStock === true;
    return { inStock, price: data?.price ?? null };
  } catch (err) {
    if (err.response?.status === 429) {
      log.warn("Walgreens: rate limited — will retry next cycle");
    } else {
      log.error(`Walgreens check failed for SKU ${sku}:`, err.message, err.response?.data);
    }
    return { inStock: false, price: null };
  }
}
