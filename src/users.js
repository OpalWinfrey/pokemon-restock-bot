/**
 * Per-user preferences — stored in config/users.json.
 * Each user has a zip code, radius, and list of product subscriptions.
 * Set via Discord slash commands.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const USERS_FILE = join(__dir, "../config/users.json");

function load() {
  if (!existsSync(USERS_FILE)) return [];
  return JSON.parse(readFileSync(USERS_FILE, "utf8"));
}

function save(users) {
  writeFileSync(USERS_FILE, JSON.stringify(users, null, 2) + "\n");
}

export function getUsers() {
  return load();
}

export function setUserLocation(discordUserId, username, zip, radiusMiles) {
  const users = load();
  const idx = users.findIndex(u => u.discordUserId === discordUserId);
  const existing = users[idx] ?? {};
  const entry = { ...existing, discordUserId, username, zip, radiusMiles };

  if (idx >= 0) users[idx] = entry;
  else users.push(entry);

  save(users);
  return entry;
}

export function addSubscription(discordUserId, username, keyword) {
  const users = load();
  let user = users.find(u => u.discordUserId === discordUserId);

  if (!user) {
    user = { discordUserId, username, subscriptions: [] };
    users.push(user);
  }

  user.subscriptions = user.subscriptions ?? [];
  const normalized = keyword.toLowerCase().trim();

  if (!user.subscriptions.includes(normalized)) {
    user.subscriptions.push(normalized);
    save(users);
    return true;
  }
  return false;
}

export function removeSubscription(discordUserId, keyword) {
  const users = load();
  const user = users.find(u => u.discordUserId === discordUserId);
  if (!user) return false;

  const normalized = keyword.toLowerCase().trim();
  const before = user.subscriptions?.length ?? 0;
  user.subscriptions = (user.subscriptions ?? []).filter(s => s !== normalized);

  if (user.subscriptions.length < before) {
    save(users);
    return true;
  }
  return false;
}

// Returns Discord mention strings for users subscribed to a given product name
export function getMentionsForProduct(productName) {
  const lower = productName.toLowerCase();
  return load()
    .filter(u => (u.subscriptions ?? []).some(sub => lower.includes(sub)))
    .map(u => `<@${u.discordUserId}>`);
}
