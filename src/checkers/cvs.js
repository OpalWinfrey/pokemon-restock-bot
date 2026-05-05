import axios from "axios";
import { log } from "../logger.js";

export async function checkCVS({ upc, storeId }) {
  try {
    const { data } = await axios.get(
      `https://www.cvs.com/rest/bean/storeInfo/getStoreProductAvailability/${upc}`,
      {
        params: { storeId },
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json"
        },
        timeout: 10000
      }
    );

    log.debug("CVS response for UPC", upc, data);
    const storeData = Array.isArray(data) ? data.find(s => String(s.storeId) === String(storeId)) : data;
    const inStock = storeData?.availabilityStatus === "IN_STOCK" || storeData?.available === true;
    return { inStock, price: storeData?.price ?? null };
  } catch (err) {
    if (err.response?.status === 429) {
      log.warn("CVS: rate limited — will retry next cycle");
    } else {
      log.error(`CVS check failed for UPC ${upc}:`, err.message, err.response?.data);
    }
    return { inStock: false, price: null };
  }
}
