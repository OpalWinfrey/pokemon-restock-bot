import axios from "axios";

export async function checkWalmart({ itemId, storeId }) {
  const url = `https://www.walmart.com/store/ajax/selected-item/details`;

  try {
    const response = await axios.get(url, {
      params: { itemId, storeId },
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json"
      },
      timeout: 10000
    });

    const data = response.data;

    if (!data) {
      console.warn(`⚠️  Walmart: No data returned for item ${itemId}`);
      return { inStock: false, price: null };
    }

    const availabilityStatus =
      data.availabilityStatus ||
      data.store?.availability?.availabilityStatus ||
      null;

    const inStock = availabilityStatus === "IN_STOCK";
    const price = data.priceInfo?.currentPrice?.price ?? null;

    return { inStock, price };
  } catch (err) {
    if (err.response?.status === 429) {
      console.warn("⚠️  Walmart: Rate limited. Will retry next cycle.");
    } else {
      console.error(`❌ Walmart check failed for item ${itemId}:`, err.message);
    }
    return { inStock: false, price: null };
  }
}
