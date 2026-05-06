import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { log } from "./logger.js";

puppeteer.use(StealthPlugin());

let browser = null;

// Serial queue — one browser operation at a time, no burst patterns
let _queue = Promise.resolve();
function enqueue(fn) {
  const result = _queue.then(fn);
  _queue = result.catch(() => {});
  return result;
}

async function launchBrowser() {
  browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  });
  browser.on("disconnected", () => {
    browser = null;
    log.warn("Browser disconnected — will relaunch on next request");
  });
  return browser;
}

export async function getBrowser() {
  if (!browser || !browser.connected) await launchBrowser();
  return browser;
}

// Fire fetch() from inside the browser after visiting the origin homepage once.
// Uses domcontentloaded (not networkidle2) to avoid 30s timeouts on heavy pages.
// All calls go through the serial queue so PX never sees burst requests.
export function browserFetch(origin, url, options = {}) {
  return enqueue(async () => {
    const b = await getBrowser();
    const page = await b.newPage();
    // Brief pause so the stealth plugin finishes its onPageCreated setup
    await new Promise(r => setTimeout(r, 100));
    try {
      await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 30000 });
      await new Promise(r => setTimeout(r, 800));

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
      await page.close().catch(() => {});
    }
  });
}

// Full page navigation — for checkers that need to scrape rendered HTML.
// Extra args are forwarded to page.evaluate.
export function browserNavigate(origin, targetUrl, extractFn, ...args) {
  return enqueue(async () => {
    const b = await getBrowser();
    const page = await b.newPage();
    await new Promise(r => setTimeout(r, 100));
    try {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
      return await page.evaluate(extractFn, ...args);
    } finally {
      await page.close().catch(() => {});
    }
  });
}

// Legacy export used by checkers that manage their own page
export async function ensureWarmed(page, origin) {
  await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 30000 });
  await new Promise(r => setTimeout(r, 800));
}
