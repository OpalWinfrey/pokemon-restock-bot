import axios from "axios";
import { log } from "../logger.js";
import { apiHeaders } from "../http.js";

export async function checkTarget({ tcin, storeId }) {
  try {
    const { data } = await axios.get(
      "https://redsky.target.com/redsky_aggregations/v1/web/pdp_client_v1",
      {
        params: {
          tcin, store_id: storeId, pricing_store_id: storeId,
          has_store_id: true, visitor_id: "anonymous", channel: "WEB", page: `/p/A-${tcin}`
        },
        headers: apiHeaders({ Referer: "https://www.target.com/" }),
        timeout: 10000
      }
    );

    const product = data?.data?.product;
    log.debug("Target response for TCIN", tcin, product?.fulfillment);

    if (!product) {
      log.warn(`Target: no product data for TCIN ${tcin} — check the TCIN is correct`);
      return { inStock: false, price: null };
    }

    const storeOptions = product.fulfillment?.store_options?.[0];
    const inStock =
      storeOptions?.in_store_only?.availability_status === "IN_STOCK" ||
      storeOptions?.order_pickup?.availability_status === "IN_STOCK";
    const price = product.price?.current_retail ?? null;

    return { inStock, price };
  } catch (err) {
    if (err.response?.status === 429) {
      log.warn("Target: rate limited — will retry next cycle");
    } else {
      log.error(`Target check failed for TCIN ${tcin}:`, err.message, err.response?.data);
    }
    return { inStock: false, price: null };
  }
}
