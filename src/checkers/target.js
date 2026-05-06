import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { log } from "../logger.js";

puppeteer.use(StealthPlugin());

let browser = null;

async function getBrowser() {
  if (!browser || !browser.connected) {
    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  }
  return browser;
}

// Intercept the redsky API call the page fires automatically on load.
// Works for both online and in-store — with storeId the page fires a store-specific request.
async function checkTargetViaIntercept({ tcin, storeId = null }) {
  const b = await getBrowser();
  const page = await b.newPage();
  try {
    await page.setRequestInterception(true);
    let apiData = null;

    page.on("request", req => {
      const url = req.url();
      // Block heavy assets to speed up load
      if (["image", "stylesheet", "font", "media"].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    page.on("response", async res => {
      const url = res.url();
      if (url.includes("redsky.target.com") && url.includes("pdp_client")) {
        try { apiData = await res.json(); } catch {}
      }
    });

    const url = storeId
      ? `https://www.target.com/p/A-${tcin}?preselect=${storeId}`
      : `https://www.target.com/p/A-${tcin}`;

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    // Give the page time to fire its API calls
    await new Promise(r => setTimeout(r, 4000));

    if (!apiData) {
      log.warn(`Target: no API response intercepted for TCIN ${tcin}`);
      return { inStock: false, price: null };
    }

    const product = apiData?.data?.product ?? null;
    if (!product) return { inStock: false, price: null };

    const price = product.price?.current_retail ?? null;
    const fulfillment = product.fulfillment ?? {};

    if (storeId) {
      const storeOptions = fulfillment.store_options ?? [];
      const opt = storeOptions.find(o => String(o.store?.store_id ?? "") === String(storeId)) ?? storeOptions[0] ?? null;
      const status = opt?.order_pickup?.availability_status ?? opt?.in_store_only?.availability_status ?? "";
      const inStock = status === "IN_STOCK" || status === "AVAILABLE";
      log.debug(`Target in-store TCIN ${tcin} store ${storeId}: ${status} inStock=${inStock}`);
      return { inStock, price, isOnline: false };
    } else {
      const status = fulfillment.shipping_options?.availability_status ?? "";
      const inStock = status === "IN_STOCK";
      log.debug(`Target online TCIN ${tcin}: ${status} inStock=${inStock}`);
      return { inStock, price, isOnline: true };
    }
  } catch (err) {
    log.warn(`Target check failed for TCIN ${tcin}: ${err.message}`);
    return { inStock: false, price: null };
  } finally {
    await page.close();
  }
}

export async function checkTarget({ tcin, storeId }) {
  return checkTargetViaIntercept({ tcin, storeId: storeId ?? null });
}
