import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { log } from "./logger.js";

puppeteer.use(StealthPlugin());

let browser = null;
const warmed = {};

// Serial queue — only one browser request at a time so PX doesn't see a burst
let _queue = Promise.resolve();
function enqueue(fn) {
  const result = _queue.then(fn);
  _queue = result.catch(() => {});
  return result;
}

export async function getBrowser() {
  if (!browser || !browser.connected) {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
    Object.keys(warmed).forEach(k => delete warmed[k]);
  }
  return browser;
}

// Ensure the page has visited the retailer's homepage so session cookies are set
export async function ensureWarmed(page, origin) {
  const url = page.url();
  if (!warmed[origin] || !url.includes(new URL(origin).hostname)) {
    await page.goto(origin, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise(r => setTimeout(r, 1500));
    warmed[origin] = true;
    log.debug(`Browser: session warmed for ${origin}`);
  }
}

// Fire a fetch() from inside the browser page — bypasses bot detection
// since the request carries real browser cookies and fingerprint.
// Serialized through a queue so only one browser request runs at a time.
export function browserFetch(origin, url, options = {}) {
  return enqueue(async () => {
    const b = await getBrowser();
    const page = await b.newPage();
    try {
      await ensureWarmed(page, origin);
      const result = await page.evaluate(async (fetchUrl, fetchOptions) => {
        try {
          const res = await fetch(fetchUrl, {
            headers: { Accept: "application/json", ...fetchOptions.headers },
            method: fetchOptions.method ?? "GET",
            body: fetchOptions.body ?? undefined
          });
          if (!res.ok) return { __error: res.status };
          return await res.json();
        } catch (e) {
          return { __error: e.message };
        }
      }, url, options);
      return result;
    } finally {
      await page.close();
    }
  });
}
