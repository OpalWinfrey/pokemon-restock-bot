import axios from "axios";

export async function checkTarget({ tcin, storeId }) {
  const url = `https://redsky.target.com/redsky_aggregations/v1/web/pdp_client_v1`;

  const params = {
    tcin,
    store_id: storeId,
    pricing_store_id: storeId,
    has_store_id: true,
    visitor_id: "anonymous",
    channel: "WEB",
    page: `/p/A-${tcin}`
  };

  try {
    const response = await axios.get(url, {
      params,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      timeout: 10000
    });

    const data = response.data?.data?.product;

    if (!data) {
      console.warn(`⚠️  Target: No product data returned for TCIN ${tcin}`);
      return { inStock: false, price: null };
    }

    const storeOptions = data.fulfillment?.store_options?.[0];
    const inStock =
      storeOptions?.in_store_only?.availability_status === "IN_STOCK" ||
      storeOptions?.order_pickup?.availability_status === "IN_STOCK";

    const price = data.price?.current_retail ?? null;

    return { inStock, price };
  } catch (err) {
    if (err.response?.status === 429) {
      console.warn("⚠️  Target: Rate limited. Will retry next cycle.");
    } else {
      console.error(`❌ Target check failed for TCIN ${tcin}:`, err.message);
    }
    return { inStock: false, price: null };
  }
}
