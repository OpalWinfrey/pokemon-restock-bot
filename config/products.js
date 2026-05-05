import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
export const products = JSON.parse(readFileSync(join(__dir, "products.json"), "utf8"));
