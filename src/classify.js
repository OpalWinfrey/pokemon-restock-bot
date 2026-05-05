const CATEGORIES = [
  { key: "etb",        keywords: ["elite trainer box", "etb"] },
  { key: "boosterBox", keywords: ["booster box"] },
  { key: "bundle",     keywords: ["booster bundle", "bundle box"] },
  { key: "tin",        keywords: ["tin", "collector tin"] },
  { key: "premium",    keywords: ["premium collection", "ultra premium", "special collection", "collection box"] },
  { key: "singles",    keywords: ["blister", "single pack", "3-pack", "2-pack", "booster pack"] }
];

// Returns every category this product belongs to.
// Everything also gets "all" — that's the catch-all role.
export function getProductCategories(name) {
  const lower = name.toLowerCase();
  const matched = CATEGORIES.filter(c => c.keywords.some(kw => lower.includes(kw))).map(c => c.key);
  return ["all", ...matched];
}

// Hot = products that sell out fast and deserve their own channel
export function isHotProduct(name) {
  const cats = getProductCategories(name);
  return cats.some(c => ["etb", "boosterBox", "premium"].includes(c));
}
