import axios from "axios";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { log } from "./logger.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const PRODUCTS_FILE = join(__dir, "../config/products.json");

// Every meaningful Pokemon card product type. Multiple terms catch products
// that only appear under one category heading on a given retailer's site.
const SEARCH_TERMS = [
  "pokemon elite trainer box",
  "pokemon booster box",
  "pokemon booster bundle",
  "pokemon premium collection",
  "pokemon ultra premium collection",
  "pokemon special collection",
  "pokemon tin",
  "pokemon build battle box",
  "pokemon blister pack",
  "pokemon trading cards"
];

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
};

// --- Name normalization + dedup ---

function normalizeName(name) {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function isSameProduct(nameA, nameB) {
  const stopWords = new Set(["the", "and", "for", "with", "new", "set", "pokemon"]);
  const words = n => new Set(normalizeName(n).split(" ").filter(w => w.length > 2 && !stopWords.has(w)));
  const a = words(nameA), b = words(nameB);
  const shared = [...a].filter(w => b.has(w)).length;
  const union = new Set([...a, ...b]).size;
  return union > 0 && shared / union >= 0.5;
}

// Filter out non-card products that sneak into search results
function isPokemonCard(name) {
  const n = name.toLowerCase();
  const exclude = ["sleeve", "binder", "playmat", "figure", "plush", "game boy", "nintendo switch",
    "video game", "stuffed", "backpack", "shirt", "hat", "funko", "puzzle", "pencil"];
  return !exclude.some(kw => n.includes(kw));
}

// --- Per-retailer search (runs all SEARCH_TERMS and deduplicates) ---

async function searchTarget(term) {
  const { data } = await axios.get(
    "https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v1",
    {
      params: { keyword: term, count: 24, offset: 0, channel: "WEB", visitor_id: "anonymous" },
      headers: HEADERS, timeout: 15000
    }
  );
  return (data?.data?.search?.products ?? []).map(p => {
    const tcin = p.item?.tcin;
    const images = p.item?.enrichment?.images;
    return {
      name: p.item?.product_description?.title ?? "",
      imageUrl: images?.primary_image_url ?? null,
      price: p.item?.price?.current_retail ?? null,
      retailer: "target",
      cfg: { tcin, url: `https://www.target.com/p/-/A-${tcin}` }
    };
  }).filter(p => p.name && p.cfg.tcin && isPokemonCard(p.name));
}

async function searchWalmart(term) {
  const { data: html } = await axios.get("https://www.walmart.com/search", {
    params: { q: term },
    headers: { ...HEADERS, Accept: "text/html" }, timeout: 15000
  });
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) return [];
  const items =
    JSON.parse(match[1])?.props?.pageProps?.initialData?.searchResult?.itemStacks?.[0]?.items ?? [];
  return items.filter(item => item.usItemId).map(item => ({
    name: item.name ?? "",
    imageUrl: item.imageInfo?.thumbnailUrl ?? null,
    price: item.price ?? null,
    retailer: "walmart",
    cfg: { itemId: String(item.usItemId), url: `https://www.walmart.com/ip/${item.usItemId}` }
  })).filter(p => p.name && isPokemonCard(p.name));
}

async function searchGameStop(term) {
  const { data } = await axios.get(
    "https://www.gamestop.com/on/demandware.store/Sites-gamestop-us-Site/en_US/Search-UpdateGrid",
    {
      params: { q: term, start: 0, sz: 24, format: "ajax" },
      headers: { ...HEADERS, Accept: "application/json, text/html" }, timeout: 15000
    }
  );
  const products = data?.hits ?? data?.productSearchResult?.hits ?? [];
  return products.map(p => ({
    name: p.productName ?? p.name ?? "",
    imageUrl: p.images?.[0]?.url ?? null,
    price: p.price?.sales?.value ?? null,
    retailer: "gamestop",
    cfg: {
      productId: p.id ?? p.productID,
      url: `https://www.gamestop.com${p.selectedProductUrl ?? ""}`
    }
  })).filter(p => p.name && p.cfg.productId && isPokemonCard(p.name));
}

async function searchSamsClub(term) {
  const { data } = await axios.get(
    "https://www.samsclub.com/api/node/vivaldi/v2/products/search",
    {
      params: { searchTerm: term, pageSize: 24, offset: 0 },
      headers: { ...HEADERS, Accept: "application/json" }, timeout: 15000
    }
  );
  const items = data?.payload?.records ?? [];
  return items.map(p => ({
    name: p.displayName ?? p.name ?? "",
    imageUrl: p.images?.[0]?.url ?? null,
    price: p.prices?.finalPrice?.price ?? null,
    retailer: "samsclub",
    cfg: {
      itemId: String(p.skuId ?? p.itemId ?? ""),
      url: `https://www.samsclub.com/p/${p.seoName ?? "product"}/${p.skuId}`
    }
  })).filter(p => p.name && p.cfg.itemId && isPokemonCard(p.name));
}

// Run one search term against all retailers, return flat array
async function runTerm(term) {
  log.debug(`  Searching: "${term}"`);
  const results = await Promise.allSettled([
    searchTarget(term),
    searchWalmart(term),
    searchGameStop(term),
    searchSamsClub(term)
  ]);
  return results.flatMap(r => r.status === "fulfilled" ? r.value : []);
}

// --- MSRP detection: lowest price seen for a product across all retailers ---

function inferMsrp(existingMsrp, prices) {
  const valid = prices.filter(p => p != null && p > 0);
  if (!valid.length) return existingMsrp ?? null;
  const lowest = Math.min(...valid);
  // Only update MSRP if we see a price that's meaningfully lower (retailer sale vs MSRP)
  if (!existingMsrp || lowest < existingMsrp) return lowest;
  return existingMsrp;
}

// --- Merge into products.json ---

function mergeIntoProducts(existing, discovered) {
  let added = 0;

  // Deduplicate within discovered first
  const deduped = [];
  for (const item of discovered) {
    const dup = deduped.find(d => d.retailer === item.retailer && d.cfg[Object.keys(item.cfg)[0]] === item.cfg[Object.keys(item.cfg)[0]]);
    if (!dup) deduped.push(item);
  }

  for (const item of deduped) {
    let product = existing.find(p => isSameProduct(p.name, item.name));

    if (!product) {
      product = { name: item.name, imageUrl: null, msrp: null, retailers: {} };
      existing.push(product);
      added++;
    }

    if (!product.imageUrl && item.imageUrl) product.imageUrl = item.imageUrl;
    product.msrp = inferMsrp(product.msrp, [item.price]);

    if (!product.retailers[item.retailer]) {
      product.retailers[item.retailer] = item.cfg;
    }
  }

  return added;
}

async function trySearch(retailer, fn) {
  try {
    const results = await fn();
    log.info(`  🔎 ${retailer}: found ${results.length} product(s)`);
    return results;
  } catch (err) {
    log.warn(`  ${retailer}: discovery failed — ${err.message}`);
    return [];
  }
}

export async function discoverProducts() {
  log.info("\n🧭 Auto-discovering Pokemon products...");

  // Run all search terms, collect everything, then merge
  const allResults = [];
  for (const term of SEARCH_TERMS) {
    const results = await runTerm(term);
    allResults.push(...results);
  }

  log.info(`  Found ${allResults.length} raw results across all search terms`);

  let existing = [];
  try {
    existing = JSON.parse(readFileSync(PRODUCTS_FILE, "utf8"));
  } catch {
    log.warn("products.json unreadable — starting fresh");
  }

  const added = mergeIntoProducts(existing, allResults);

  try {
    writeFileSync(PRODUCTS_FILE, JSON.stringify(existing, null, 2) + "\n");
  } catch (err) {
    log.error("Failed to save products.json:", err.message);
  }

  log.info(`  ✅ Discovery complete — ${added} new product(s) added, ${existing.length} total tracked`);

  return existing;
}
