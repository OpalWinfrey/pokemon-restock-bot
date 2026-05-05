import axios from "axios";
import { browserHeaders } from "../http.js";
import { log } from "../logger.js";

// Pokemon Center sells online only — no store IDs.
// storeId is ignored; we check online availability directly.
export async function checkPokemonCenter({ itemId, url }) {
  try {
    const { data } = await axios.get(
      `https://www.pokemoncenter.com/api/2.0/products/${itemId}/availability`,
      {
        headers: browserHeaders({ Referer: "https://www.pokemoncenter.com/", Origin: "https://www.pokemoncenter.com" }),
        timeout: 10000
      }
    );

    const available = data?.orderable ?? data?.available ?? data?.inStock ?? false;
    const price = data?.price?.sales?.value ?? data?.price?.regular?.value ?? null;

    log.debug(`Pokemon Center item ${itemId}: orderable=${available}`);
    return { inStock: !!available, price, isOnline: true };
  } catch (err) {
    if (err.response?.status === 429) {
      log.warn("Pokemon Center: rate limited");
    } else if (err.response?.status === 404) {
      log.debug(`Pokemon Center: item ${itemId} not found (may be out of print)`);
    } else {
      log.error(`Pokemon Center check failed for ${itemId}:`, err.message);
    }
    return { inStock: false, price: null, isOnline: true };
  }
}
