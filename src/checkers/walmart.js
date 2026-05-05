import { browserHeaders } from "../http.js";
import axios from "axios";
import { log } from "../logger.js";

// Checks Walmart.com online availability via the item page JSON blob.
// The store-level API (/store/ajax/selected-item/details) requires a storeId and
// is blocked from cloud IPs. This reads the __NEXT_DATA__ blob like discovery does.
export async function checkWalmart({ itemId }) {
  try {
    const { data: html } = await axios.get(`https://www.walmart.com/ip/${itemId}`, {
      headers: browserHeaders({ Referer: "https://www.walmart.com/" }),
      timeout: 15000
    });

    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!match) {
      log.warn(`Walmart: no __NEXT_DATA__ for item ${itemId}`);
      return { inStock: false, price: null };
    }

    const pageData = JSON.parse(match[1]);
    const item = pageData?.props?.pageProps?.initialData?.data?.product;
    if (!item) return { inStock: false, price: null };

    const availabilityStatus = item.availabilityStatus ?? item.fulfillmentLabel ?? "";
    const inStock = availabilityStatus === "IN_STOCK" || availabilityStatus.toLowerCase().includes("add to cart");
    const price = item.priceInfo?.currentPrice?.price ?? null;

    return { inStock, price, isOnline: true };
  } catch (err) {
    if (err.response?.status === 429) {
      log.warn(`Walmart: rate limited — will retry next cycle`);
    } else {
      log.error(`Walmart check failed for item ${itemId}:`, err.message);
    }
    return { inStock: false, price: null };
  }
}
