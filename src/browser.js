import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { log } from "./logger.js";

puppeteer.use(StealthPlugin());

let browser = null;
// One persistent page per origin — warm once, reuse for all subsequent fetches
const pages = {};

// Serial queue — one browser operation at a time
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
    Object.keys(pages).forEach(k => delete pages[k]);
    log.warn("Browser disconnected — will relaunch on next request");
  });
  return browser;
}

export async function getBrowser() {
  if (!browser || !browser.connected) await launchBrowser();
  return browser;
}

// Returns the persistent warmed page for this origin, navigating once if needed.
// Uses domcontentloaded (not networkidle2) so we don't time out on heavy pages.
async function getWarmPage(origin) {
  const b = await getBrowser();

  if (pages[origin]) {
    try {
      // Verify page is still usable
      await pages[origin].evaluate(() => document.readyState);
      return pages[origin];
    } catch {
      delete pages[origin];
    }
  }

  const page = await b.newPage();
  await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
  log.debug(`Browser: warming session for ${origin}…`);
  await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));
  pages[origin] = page;
  log.debug(`Browser: session ready for ${origin}`);
  return page;
}

// Fire a fetch() from inside the warmed browser page for this origin.
// All calls are serialized so PX never sees burst requests.
export function browserFetch(origin, url, options = {}) {
  return enqueue(async () => {
    const page = await getWarmPage(origin);
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
  });
}

// Used by checkers that need full page navigation (e.g. Walmart).
// Still goes through the queue and gets a fresh page.
// Extra args are forwarded to page.evaluate() so you can pass Node values in.
export function browserNavigate(origin, targetUrl, extractFn, ...args) {
  return enqueue(async () => {
    const b = await getBrowser();
    const page = await b.newPage();
    try {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
      return await page.evaluate(extractFn, ...args);
    } finally {
      await page.close();
    }
  });
}

// Also export ensureWarmed for checkers that open their own page
export async function ensureWarmed(page, origin) {
  await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 30000 });
  await new Promise(r => setTimeout(r, 1000));
}
