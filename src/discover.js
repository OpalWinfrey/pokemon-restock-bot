/**
 * Auto-discovers Pokemon card products across all retailers.
 * Runs on startup and on a configurable interval (DISCOVER_INTERVAL_HOURS).
 * New products are merged into config/products.json so they persist across restarts.
 */

import axios from "axios";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const PRODUCTS_FILE = join(__dir, "../config/products.json");

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
};

// --- Normalize product names for cross-retailer matching ---

function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function wordOverlap(a, b) {
  const stopWords = new Set(["the", "and", "for", "with", "new", "set"]);
  const wordsA = new Set(normalizeName(a).split(" ").filter(w => w.length > 2 && !stopWords.has(w)));
  const wordsB = new Set(normalizeName(b).split(" ").filter(w => w.length > 2 && !stopWords.has(w)));
  const shared = [...wordsA].filter(w => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 ? shared / union : 0;
}

function isSameProduct(nameA, nameB) {
  return wordOverlap(nameA, nameB) >= 0.5;
}

// --- Per-retailer search functions ---

async function discoverTarget() {
  const { data } = await axios.get(
    "https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v1",
    {
      params: {
        keyword: "pokemon trading cards",
        count: 24,
        offset: 0,
        channel: "WEB",
        visitor_id: "anonymous"
      },
      headers: HEADERS,
      timeout: 15000
    }
  );

  return (data?.data?.search?.products ?? []).map(p => {
    const tcin = p.item?.tcin;
    return {
      name: p.item?.product_description?.title ?? "",
      retailer: "target",
      cfg: { tcin, url: `https://www.target.com/p/-/A-${tcin}` }
    };
  }).filter(p => p.name && p.cfg.tcin);
}

async function discoverWalmart() {
  const { data: html } = await axios.get("https://www.walmart.com/search", {
    params: { q: "pokemon trading cards" },
    headers: { ...HEADERS, Accept: "text/html" },
    timeout: 15000
  });

  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) return [];

  const items =
    JSON.parse(match[1])?.props?.pageProps?.initialData?.searchResult?.itemStacks?.[0]?.items ?? [];

  return items
    .filter(item => item.usItemId)
    .map(item => {
      const itemId = String(item.usItemId);
      return {
        name: item.name ?? "",
        retailer: "walmart",
        cfg: { itemId, url: `https://www.walmart.com/ip/${itemId}` }
      };
    })
    .filter(p => p.name);
}

async function discoverBestBuy() {
  const apiKey = process.env.BESTBUY_API_KEY;
  if (!apiKey) return [];

  const { data } = await axios.get(
    `https://api.bestbuy.com/v1/products(search=pokemon+trading+cards)`,
    {
      params: { apiKey, show: "sku,name,salePrice,url", format: "json", pageSize: 24 },
      timeout: 15000
    }
  );

  return (data?.products ?? []).map(p => ({
    name: p.name ?? "",
    retailer: "bestbuy",
    cfg: { sku: String(p.sku), url: p.url ?? `https://www.bestbuy.com/site/-/${p.sku}.p` }
  })).filter(p => p.name);
}

async function discoverCostco() {
  const { data: html } = await axios.get("https://www.costco.com/CatalogSearch", {
    params: { dept: "All", keyword: "pokemon cards", view: "grid", lang: "en-US" },
    headers: { ...HEADERS, Accept: "text/html" },
    timeout: 15000
  });

  const results = [];
  const matches = html.matchAll(/data-product-id="(\d{7,})"[^>]*>[\s\S]*?class="[^"]*product-title[^"]*"[^>]*>([^<]+)</g);
  for (const m of matches) {
    const itemNumber = m[1];
    const name = m[2].trim();
    results.push({
      name,
      retailer: "costco",
      cfg: { itemNumber, url: `https://www.costco.com/product.${itemNumber}.html` }
    });
  }
  return results;
}

// --- Merge discovered products into the persisted list ---

function mergeIntoProducts(existing, discovered) {
  let added = 0;

  for (const item of discovered) {
    // Find an existing product with a similar name
    let product = existing.find(p => isSameProduct(p.name, item.name));

    if (!product) {
      // Brand-new product — add it
      product = { name: item.name, retailers: {} };
      existing.push(product);
      added++;
    }

    // Add this retailer's data if we don't already have it
    if (!product.retailers[item.retailer]) {
      product.retailers[item.retailer] = item.cfg;
    }
  }

  return added;
}

// --- Main export ---

async function tryDiscover(retailer, fn) {
  try {
    const results = await fn();
    console.log(`  🔎 ${retailer}: found ${results.length} product(s)`);
    return results;
  } catch (err) {
    console.warn(`  ⚠️  ${retailer}: discovery failed — ${err.message}`);
    return [];
  }
}

export async function discoverProducts() {
  console.log("\n🧭 Auto-discovering Pokemon products...");

  const [target, walmart, bestbuy, costco] = await Promise.all([
    tryDiscover("Target", discoverTarget),
    tryDiscover("Walmart", discoverWalmart),
    tryDiscover("Best Buy", discoverBestBuy),
    tryDiscover("Costco", discoverCostco)
  ]);

  const allDiscovered = [...target, ...walmart, ...bestbuy, ...costco];

  const existing = JSON.parse(readFileSync(PRODUCTS_FILE, "utf8"));
  const added = mergeIntoProducts(existing, allDiscovered);

  writeFileSync(PRODUCTS_FILE, JSON.stringify(existing, null, 2) + "\n");

  console.log(`  ✅ Discovery complete — ${added} new product(s) added, ${existing.length} total tracked`);

  return existing;
}
