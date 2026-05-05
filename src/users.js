import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const USERS_FILE = join(__dir, "../config/users.json");

function load() {
  if (!existsSync(USERS_FILE)) return [];
  try { return JSON.parse(readFileSync(USERS_FILE, "utf8")); } catch { return []; }
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
  const entry = { ...(users[idx] ?? {}), discordUserId, username, zip, radiusMiles };
  if (idx >= 0) users[idx] = entry;
  else users.push(entry);
  save(users);
  return entry;
}

// Returns true if the user wants alerts from this retailer.
// Defaults to true (opt-out model) — user must explicitly disable a retailer.
export function userWantsRetailer(discordUserId, retailerKey) {
  const user = load().find(u => u.discordUserId === discordUserId);
  if (!user) return true;
  return !(user.disabledRetailers ?? []).includes(retailerKey);
}

// Toggles a retailer on/off for a user. Returns true if now enabled, false if disabled.
export function toggleRetailerPref(discordUserId, username, retailerKey) {
  const users = load();
  let user = users.find(u => u.discordUserId === discordUserId);
  if (!user) {
    user = { discordUserId, username, disabledRetailers: [] };
    users.push(user);
  }
  if (!user.disabledRetailers) user.disabledRetailers = [];

  const idx = user.disabledRetailers.indexOf(retailerKey);
  if (idx >= 0) {
    user.disabledRetailers.splice(idx, 1); // was disabled → now enabled
    save(users);
    return true;
  } else {
    user.disabledRetailers.push(retailerKey); // was enabled → now disabled
    save(users);
    return false;
  }
}
