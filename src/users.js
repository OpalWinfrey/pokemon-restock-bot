/**
 * Per-user location preferences.
 * Set via /setlocation in Discord.
 * Subscriptions are now handled by Discord roles — no keyword subs here.
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
  const entry = { ...(users[idx] ?? {}), discordUserId, username, zip, radiusMiles };

  if (idx >= 0) users[idx] = entry;
  else users.push(entry);

  save(users);
  return entry;
}
