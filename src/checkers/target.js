import axios from "axios";
import { log } from "../logger.js";
import { apiHeaders } from "../http.js";

// Checks Target.com online availability. storeId is optional — if provided,
// also checks in-store/order-pickup status. Without it, checks ship-to-address only.
export async function checkTarget({ tcin, storeId = null }) {
  try {
    const params = {
      tcin, visitor_id: "anonymous", channel: "WEB", page: `/p/A-${tcin}`
    };
    if (storeId) {
      params.store_id = storeId;
      params.pricing_store_id = storeId;
      params.has_store_id = true;
    }

    const { data } = await axios.get(
      "https://redsky.target.com/redsky_aggregations/v1/web/pdp_client_v1",
      { params, headers: apiHeaders({ Referer: "https://www.target.com/" }), timeout: 10000 }
    );

    const product = data?.data?.product;
    if (!product) {
      log.warn(`Target: no product data for TCIN ${tcin}`);
      return { inStock: false, price: null };
    }

    const fulfillment = product.fulfillment;
    const price = product.price?.current_retail ?? null;

    // In-store / order pickup (only if we have a store ID)
    if (storeId) {
      const storeOptions = fulfillment?.store_options?.[0];
      const inStoreStock =
        storeOptions?.in_store_only?.availability_status === "IN_STOCK" ||
        storeOptions?.order_pickup?.availability_status === "IN_STOCK";
      return { inStock: inStoreStock, price, isOnline: false };
    }

    // Online (ship-to-address)
    const onlineStatus = fulfillment?.shipping_options?.availability_status;
    const inStock = onlineStatus === "IN_STOCK";
    return { inStock, price, isOnline: true };
  } catch (err) {
    if (err.response?.status === 429) {
      log.warn(`Target: rate limited — will retry next cycle`);
    } else {
      log.error(`Target check failed for TCIN ${tcin}:`, err.message);
    }
    return { inStock: false, price: null };
  }
}
