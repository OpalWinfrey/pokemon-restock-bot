import axios from "axios";

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

    const storeData = Array.isArray(data) ? data.find(s => String(s.storeId) === String(storeId)) : data;
    const inStock = storeData?.availabilityStatus === "IN_STOCK" || storeData?.available === true;
    const price = storeData?.price ?? null;

    return { inStock, price };
  } catch (err) {
    if (err.response?.status === 429) {
      console.warn("⚠️  CVS: Rate limited. Will retry next cycle.");
    } else {
      console.error(`❌ CVS check failed for UPC ${upc}:`, err.message);
    }
    return { inStock: false, price: null };
  }
}
