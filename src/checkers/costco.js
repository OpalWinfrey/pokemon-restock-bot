import axios from "axios";

// Costco has no public inventory API. This checks warehouse pickup availability
// via the internal endpoint their site uses — may break if Costco changes their API.
export async function checkCostco({ itemNumber, warehouseId }) {
  const url = "https://www.costco.com/AjaxWarehousePickupAvailabilityView";

  try {
    const response = await axios.get(url, {
      params: {
        storeId: "10301",
        catalogId: "10701",
        langId: "-1",
        productId: itemNumber,
        warehouseId
      },
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/json"
      },
      timeout: 10000
    });

    const body = typeof response.data === "string" ? response.data : JSON.stringify(response.data);

    // Costco embeds availability status as a text marker in the response
    const inStock = /in.?stock|add.to.cart|available/i.test(body) &&
                    !/out.of.stock|not.available|unavailable/i.test(body);

    // Price is not reliably returned by this endpoint
    return { inStock, price: null };
  } catch (err) {
    if (err.response?.status === 429) {
      console.warn("⚠️  Costco: Rate limited. Will retry next cycle.");
    } else {
      console.error(`❌ Costco check failed for item ${itemNumber}:`, err.message);
    }
    return { inStock: false, price: null };
  }
}
