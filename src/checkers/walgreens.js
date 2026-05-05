import axios from "axios";

export async function checkWalgreens({ sku, storeNum }) {
  try {
    const { data } = await axios.post(
      "https://www.walgreens.com/store/store/details/inStore/storeProductAvailability",
      { storeNum, skuId: sku },
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        timeout: 10000
      }
    );

    const inStock = data?.availability === "IN_STOCK" || data?.inStock === true;
    const price = data?.price ?? null;

    return { inStock, price };
  } catch (err) {
    if (err.response?.status === 429) {
      console.warn("⚠️  Walgreens: Rate limited. Will retry next cycle.");
    } else {
      console.error(`❌ Walgreens check failed for SKU ${sku}:`, err.message);
    }
    return { inStock: false, price: null };
  }
}
