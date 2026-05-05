import axios from "axios";

// Requires a free Best Buy Developer API key: https://developer.bestbuy.com
export async function checkBestBuy({ sku, storeId }) {
  const apiKey = process.env.BESTBUY_API_KEY;

  if (!apiKey) {
    console.error("❌ BESTBUY_API_KEY not set in .env");
    return { inStock: false, price: null };
  }

  const url = `https://api.bestbuy.com/v1/products(sku=${sku})`;

  try {
    const response = await axios.get(url, {
      params: {
        apiKey,
        storeId,
        show: "sku,name,salePrice,inStoreAvailability",
        format: "json"
      },
      timeout: 10000
    });

    const product = response.data?.products?.[0];

    if (!product) {
      console.warn(`⚠️  Best Buy: No product found for SKU ${sku}`);
      return { inStock: false, price: null };
    }

    const inStock = product.inStoreAvailability === true;
    const price = product.salePrice ?? null;

    return { inStock, price };
  } catch (err) {
    if (err.response?.status === 429) {
      console.warn("⚠️  Best Buy: Rate limited. Will retry next cycle.");
    } else {
      console.error(`❌ Best Buy check failed for SKU ${sku}:`, err.message);
    }
    return { inStock: false, price: null };
  }
}
