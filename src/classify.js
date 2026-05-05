const CATEGORIES = [
  { key: "etb",        keywords: ["elite trainer box", "etb"] },
  { key: "boosterBox", keywords: ["booster box"] },
  { key: "bundle",     keywords: ["booster bundle", "bundle box"] },
  { key: "tin",        keywords: ["tin", "collector tin"] },
  { key: "premium",    keywords: ["premium collection", "ultra premium", "special collection", "collection box"] },
  { key: "singles",    keywords: ["blister", "single pack", "3-pack", "2-pack", "booster pack"] }
];

// Official MSRP by category. Source: Pokemon Center / major retailer shelf price.
// Used to detect reseller markups and flag out-of-print products.
const REFERENCE_MSRP = {
  etb:        49.99,
  boosterBox: 143.64,
  bundle:     19.99,
  tin:        24.99,
  premium:    49.99,   // wide range; ultra premiums are ~$119.99 but caught by "ultra premium" keyword
  singles:    null,    // too variable to pin down
  all:        null
};

// If discovered price is more than this multiple of reference MSRP, treat as out-of-print reseller pricing.
const OUT_OF_PRINT_MULTIPLIER = 2.0;

// Returns every category this product belongs to.
// Everything also gets "all" — that's the catch-all role.
export function getProductCategories(name) {
  const lower = name.toLowerCase();
  const matched = CATEGORIES.filter(c => c.keywords.some(kw => lower.includes(kw))).map(c => c.key);
  return ["all", ...matched];
}

// Returns the reference MSRP for this product name, or null if unknown.
export function getReferenceMsrp(name) {
  const cats = getProductCategories(name);
  // "ultra premium" gets a higher MSRP — check before falling through to generic "premium"
  if (name.toLowerCase().includes("ultra premium")) return 119.99;
  for (const cat of cats) {
    if (REFERENCE_MSRP[cat] != null) return REFERENCE_MSRP[cat];
  }
  return null;
}

// Returns true if the price suggests this product is out of print / reseller-only.
export function isLikelyOutOfPrint(name, price) {
  if (!price || price <= 0) return false;
  const ref = getReferenceMsrp(name);
  if (!ref) return false;
  return price > ref * OUT_OF_PRINT_MULTIPLIER;
}

// Hot = products that sell out fast and deserve their own channel
export function isHotProduct(name) {
  const cats = getProductCategories(name);
  return cats.some(c => ["etb", "boosterBox", "premium"].includes(c));
}
