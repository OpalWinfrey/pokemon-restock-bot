import axios from "axios";
import { log } from "../logger.js";
import { browserHeaders } from "../http.js";

// Checks Target.com online availability by scraping the product page HTML.
// The redsky JSON API (pdp_client_v1) returns 403 from datacenter IPs — scraping
// the product page is more resilient since it's what real browsers do.
export async function checkTarget({ tcin }) {
  try {
    const { data: html } = await axios.get(`https://www.target.com/p/A-${tcin}`, {
      headers: browserHeaders({ Referer: "https://www.target.com/c/trading-card-games/-/N-55l0h" }),
      timeout: 15000
    });

    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!match) {
      log.warn(`Target: no __NEXT_DATA__ for TCIN ${tcin}`);
      return { inStock: false, price: null };
    }

    const pageData = JSON.parse(match[1]);

    // Target buries product data deep in pageProps — path varies but product is usually here
    const pdpState =
      pageData?.props?.pageProps?.pageData?.product ??
      pageData?.props?.pageProps?.initialData?.product ??
      null;

    if (!pdpState) {
      log.warn(`Target: no product in __NEXT_DATA__ for TCIN ${tcin}`);
      return { inStock: false, price: null };
    }

    const fulfillment = pdpState.fulfillment ?? pdpState.item?.enrichment?.fulfillment ?? {};
    const price =
      pdpState.price?.current_retail ??
      pdpState.item?.price?.current_retail ??
      null;

    const onlineStatus = fulfillment?.shipping_options?.availability_status ?? "";
    const inStock = onlineStatus === "IN_STOCK";

    return { inStock, price, isOnline: true };
  } catch (err) {
    const status = err.response?.status;
    if (status === 404) {
      log.debug(`Target: TCIN ${tcin} not found (discontinued or delisted)`);
    } else if (status === 429) {
      log.warn(`Target: rate limited for TCIN ${tcin} — will retry next cycle`);
    } else if (status === 403 || status === 401) {
      log.warn(`Target: blocked (${status}) for TCIN ${tcin} — datacenter IP detected`);
    } else {
      log.error(`Target check failed for TCIN ${tcin}:`, err.message);
    }
    return { inStock: false, price: null };
  }
}
