import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { log } from "../logger.js";

puppeteer.use(StealthPlugin());

let browser = null;
let browserReady = false;

async function getBrowser() {
  if (!browser || !browser.connected) {
    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    browserReady = false;
  }
  return browser;
}

// Navigate to Target if not already there so PX cookies are in context
async function ensureOnTarget(page) {
  const url = page.url();
  if (!url.includes("target.com")) {
    if (!browserReady) log.info("Target: warming up browser session...");
    await page.goto("https://www.target.com", { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise(r => setTimeout(r, 1500));
    browserReady = true;
  }
}

export async function checkTarget({ tcin, storeId = null }) {
  const b = await getBrowser();
  const page = await b.newPage();
  try {
    await ensureOnTarget(page);

    // Fire the API call from inside the browser — PX sees a real browser making the request
    const zip = process.env.USER_ZIP ?? "45227";
    const params = new URLSearchParams({
      key: "9f36aeafbe60771e321a7cc95a78140772ab3e96",
      tcins: tcin,
      zip,
      state: "OH",
      channel: "WEB",
      visitor_id: "019DFAA0C27F0200803CEDE2427494BD",
      page: `/p/A-${tcin}`
    });
    if (storeId) {
      params.set("store_id", storeId);
      params.set("pricing_store_id", storeId);
    }

    const result = await page.evaluate(async (url) => {
      try {
        const res = await fetch(url, {
          headers: {
            "Accept": "application/json",
            "Origin": "https://www.target.com",
            "Referer": location.href
          }
        });
        if (!res.ok) return { error: res.status };
        return await res.json();
      } catch (e) {
        return { error: e.message };
      }
    }, `https://redsky.target.com/redsky_aggregations/v1/web/product_summary_with_fulfillment_v1?${params}`);

    if (result?.error) {
      log.warn(`Target API error for TCIN ${tcin}: ${result.error}`);
      if (result.error === 403 || result.error === 401) browserReady = false;
      return { inStock: false, price: null };
    }

    const product = result?.data?.product_summaries?.[0] ?? null;
    if (!product) {
      log.debug(`Target: no product data for TCIN ${tcin}`);
      return { inStock: false, price: null };
    }

    const fulfillment = product.fulfillment ?? {};
    const price = product.price?.current_retail ?? product.price?.reg_retail ?? null;

    if (storeId) {
      const storeOptions = fulfillment.store_options ?? [];
      const opt = storeOptions.find(o => String(o.store?.store_id ?? "") === String(storeId)) ?? storeOptions[0] ?? null;
      const status = opt?.order_pickup?.availability_status ?? opt?.in_store_only?.availability_status ?? "";
      const inStock = status === "IN_STOCK" || status === "AVAILABLE";
      log.debug(`Target in-store TCIN ${tcin} store ${storeId}: ${status}`);
      return { inStock, price, isOnline: false };
    } else {
      const status = fulfillment.shipping_options?.availability_status ?? "";
      const inStock = status === "IN_STOCK";
      log.debug(`Target online TCIN ${tcin}: ${status} price=${price}`);
      return { inStock, price, isOnline: true };
    }
  } catch (err) {
    log.error(`Target check failed for TCIN ${tcin}:`, err.message);
    return { inStock: false, price: null };
  } finally {
    await page.close();
  }
}
