#!/usr/bin/env node
/**
 * Usage: npm run add-product "Pokemon Prismatic Evolutions Elite Trainer Box"
 *
 * Searches Target, Walmart, Best Buy, Costco, Walgreens, and CVS for the given
 * product name, shows the top match from each retailer, and appends confirmed
 * results to config/products.json.
 */

import "dotenv/config";
import axios from "axios";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import readline from "readline";

const __dir = dirname(fileURLToPath(import.meta.url));
const PRODUCTS_FILE = join(__dir, "../config/products.json");

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
};

function ask(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => { rl.close(); resolve(answer.trim()); });
  });
}

// --- Retailer search functions ---

async function searchTarget(query) {
  const { data } = await axios.get(
    "https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v1",
    {
      params: { keyword: query, count: 5, offset: 0, channel: "WEB", visitor_id: "anonymous" },
      headers: HEADERS,
      timeout: 10000
    }
  );

  const products = data?.data?.search?.products ?? [];
  if (!products.length) return null;

  const item = products[0].item;
  const tcin = item.tcin;
  return {
    name: item.product_description?.title ?? query,
    tcin,
    url: `https://www.target.com/p/-/A-${tcin}`
  };
}

async function searchWalmart(query) {
  // Walmart embeds search results as JSON in their search page
  const { data: html } = await axios.get("https://www.walmart.com/search", {
    params: { q: query },
    headers: { ...HEADERS, Accept: "text/html" },
    timeout: 10000
  });

  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) return null;

  const pageData = JSON.parse(match[1]);
  const items =
    pageData?.props?.pageProps?.initialData?.searchResult?.itemStacks?.[0]?.items ?? [];

  if (!items.length) return null;

  const item = items[0];
  const itemId = String(item.usItemId ?? item.itemId ?? "");
  if (!itemId) return null;

  return {
    name: item.name ?? query,
    itemId,
    url: `https://www.walmart.com/ip/${itemId}`
  };
}

async function searchBestBuy(query) {
  const apiKey = process.env.BESTBUY_API_KEY;
  if (!apiKey) return null;

  const { data } = await axios.get(
    `https://api.bestbuy.com/v1/products(search=${encodeURIComponent(query)})`,
    {
      params: { apiKey, show: "sku,name,salePrice,url", format: "json", pageSize: 5 },
      timeout: 10000
    }
  );

  const product = data?.products?.[0];
  if (!product) return null;

  const sku = String(product.sku);
  return {
    name: product.name ?? query,
    sku,
    url: product.url ?? `https://www.bestbuy.com/site/-/${sku}.p`
  };
}

async function searchCostco(query) {
  const { data: html } = await axios.get("https://www.costco.com/CatalogSearch", {
    params: { dept: "All", keyword: query, view: "grid", lang: "en-US" },
    headers: { ...HEADERS, Accept: "text/html" },
    timeout: 10000
  });

  // Costco embeds product data as JSON in a script tag
  const match = html.match(/var\s+digitalData\s*=\s*(\{[\s\S]*?\});\s*(?:var|<\/script>)/);
  if (!match) {
    // Fallback: look for item numbers in the HTML
    const itemMatch = html.match(/data-product-id="(\d{7,})"/);
    if (!itemMatch) return null;
    const itemNumber = itemMatch[1];
    return {
      name: query,
      itemNumber,
      url: `https://www.costco.com/product.${itemNumber}.html`
    };
  }

  return null;
}

async function searchWalgreens(query) {
  const { data } = await axios.get("https://www.walgreens.com/search/results.jsp", {
    params: { Ntt: query, N: 0, aca: 1 },
    headers: { ...HEADERS, Accept: "application/json" },
    timeout: 10000
  });

  const products = data?.products ?? data?.results ?? [];
  if (!products.length) return null;

  const item = products[0];
  const sku = String(item.productId ?? item.sku ?? "");
  if (!sku) return null;

  return {
    name: item.productName ?? item.name ?? query,
    sku,
    url: item.productURL ?? `https://www.walgreens.com/store/c/-/ID=prod${sku}-product`
  };
}

async function searchCVS(query) {
  const { data } = await axios.get(
    `https://www.cvs.com/rest/bean/storeInfo/getSiteSearchResults/${encodeURIComponent(query)}`,
    {
      params: { pageNumber: 1, pageSize: 5 },
      headers: { ...HEADERS, Accept: "application/json" },
      timeout: 10000
    }
  );

  const products = data?.products ?? data?.results ?? [];
  if (!products.length) return null;

  const item = products[0];
  const upc = String(item.upc ?? item.productId ?? "");
  if (!upc) return null;

  return {
    name: item.productName ?? item.name ?? query,
    upc,
    url: item.productURL ?? `https://www.cvs.com/shop/-/`
  };
}

// --- Main ---

const query = process.argv.slice(2).join(" ");
if (!query) {
  console.error('Usage: npm run add-product "Pokemon Prismatic Evolutions ETB"');
  process.exit(1);
}

console.log(`\n🔍 Searching for "${query}"...\n`);

const searches = await Promise.allSettled([
  searchTarget(query),
  searchWalmart(query),
  searchBestBuy(query),
  searchCostco(query),
  searchWalgreens(query),
  searchCVS(query)
]);

const [targetRes, walmartRes, bestbuyRes, costcoRes, walgreensRes, cvsRes] = searches.map(r =>
  r.status === "fulfilled" ? r.value : null
);

const labelWidth = 12;
function row(label, result, idField, idLabel) {
  const tag = label.padEnd(labelWidth);
  if (!result) return `  ${tag}  ✗  Not found`;
  return `  ${tag}  ✓  ${result.name.slice(0, 55)}  (${idLabel}: ${result[idField]})`;
}

console.log(row("Target",    targetRes,    "tcin",       "TCIN"));
console.log(row("Walmart",   walmartRes,   "itemId",     "ID"));
console.log(row("Best Buy",  bestbuyRes,   "sku",        "SKU"));
console.log(row("Costco",    costcoRes,    "itemNumber", "Item #"));
console.log(row("Walgreens", walgreensRes, "sku",        "SKU"));
console.log(row("CVS",       cvsRes,       "upc",        "UPC"));

const anyFound = [targetRes, walmartRes, bestbuyRes, costcoRes, walgreensRes, cvsRes].some(Boolean);
if (!anyFound) {
  console.log("\n❌ No results found at any retailer.");
  process.exit(0);
}

const productName = (targetRes ?? walmartRes ?? bestbuyRes ?? costcoRes ?? walgreensRes ?? cvsRes).name;
const answer = await ask(`\nAdd "${productName}" to products.json? [Y/n] `);

if (answer.toLowerCase() === "n") {
  console.log("Cancelled.");
  process.exit(0);
}

const retailers = {};
if (targetRes)    retailers.target    = { tcin: targetRes.tcin, url: targetRes.url };
if (walmartRes)   retailers.walmart   = { itemId: walmartRes.itemId, url: walmartRes.url };
if (bestbuyRes)   retailers.bestbuy   = { sku: bestbuyRes.sku, url: bestbuyRes.url };
if (costcoRes)    retailers.costco    = { itemNumber: costcoRes.itemNumber, url: costcoRes.url };
if (walgreensRes) retailers.walgreens = { sku: walgreensRes.sku, url: walgreensRes.url };
if (cvsRes)       retailers.cvs       = { upc: cvsRes.upc, url: cvsRes.url };

const products = JSON.parse(readFileSync(PRODUCTS_FILE, "utf8"));

if (products.some(p => p.name.toLowerCase() === productName.toLowerCase())) {
  console.log(`\n⚠️  "${productName}" is already in products.json — skipping.`);
  process.exit(0);
}

products.push({ name: productName, retailers });
writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2) + "\n");

console.log(`\n✅ Added "${productName}" to products.json with ${Object.keys(retailers).length} retailer(s).`);
