const HOT_KEYWORDS = [
  "elite trainer box", "etb", "booster box", "collection box",
  "premium collection", "ultra premium", "special collection",
  "tin", "binder", "bundle box"
];

export function classifyProduct(name) {
  const lower = name.toLowerCase();
  return HOT_KEYWORDS.some(kw => lower.includes(kw)) ? "hot" : "standard";
}
