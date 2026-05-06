import { browserNavigate } from "../browser.js";
import { log } from "../logger.js";

export async function checkWalmart({ itemId, storeId = null }) {
  try {
    const result = await browserNavigate(
      "https://www.walmart.com",
      `https://www.walmart.com/ip/${itemId}`,
      (sid) => {  // sid is serialized into browser context by page.evaluate

      const el = document.getElementById("__NEXT_DATA__");
      if (!el) return null;
      const data = JSON.parse(el.textContent);
      const product = data?.props?.pageProps?.initialData?.data?.product;
      if (!product) return null;
      const status = product.availabilityStatus ?? product.fulfillmentLabel ?? "";
      const price = product.priceInfo?.currentPrice?.price ?? null;
      const pickupOptions = product.fulfillmentSummary ?? [];
      const storeAvail = sid
        ? pickupOptions.find(o => o.fulfillmentType === "PICKUP" || o.fulfillmentType === "IN_STORE")?.availabilityStatus ?? ""
        : null;
      return { status, price, storeStatus: storeAvail };
    },
    storeId  // passed as `sid` argument inside browser context
    );

    if (!result) {
      log.warn(`Walmart: no product data for item ${itemId}`);
      return { inStock: false, price: null };
    }

    const inStock = storeId
      ? result.storeStatus === "IN_STOCK" || result.storeStatus === "AVAILABLE"
      : result.status === "IN_STOCK" || result.status.toLowerCase().includes("add to cart");

    log.debug(`Walmart item ${itemId}${storeId ? ` store ${storeId}` : ""}: ${storeId ? result.storeStatus : result.status}`);
    return { inStock, price: result.price, isOnline: !storeId };
  } catch (err) {
    log.error(`Walmart check failed for item ${itemId}:`, err.message);
    return { inStock: false, price: null };
  }
}
