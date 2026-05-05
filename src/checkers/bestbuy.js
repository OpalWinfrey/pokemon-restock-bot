import axios from "axios";
import { log } from "../logger.js";

export async function checkBestBuy({ sku, storeId }) {
  const apiKey = process.env.BESTBUY_API_KEY;
  if (!apiKey) {
    log.warn("Best Buy: BESTBUY_API_KEY not set — skipping");
    return { inStock: false, price: null };
  }

  try {
    const { data } = await axios.get(`https://api.bestbuy.com/v1/products(sku=${sku})`, {
      params: { apiKey, storeId, show: "sku,name,salePrice,inStoreAvailability", format: "json" },
      timeout: 10000
    });

    const product = data?.products?.[0];
    log.debug("Best Buy response for SKU", sku, product);

    if (!product) {
      log.warn(`Best Buy: no product found for SKU ${sku}`);
      return { inStock: false, price: null };
    }

    return { inStock: product.inStoreAvailability === true, price: product.salePrice ?? null };
  } catch (err) {
    if (err.response?.status === 429) {
      log.warn("Best Buy: rate limited — will retry next cycle");
    } else {
      log.error(`Best Buy check failed for SKU ${sku}:`, err.message, err.response?.data);
    }
    return { inStock: false, price: null };
  }
}
