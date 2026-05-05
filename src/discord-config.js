/**
 * Loads channel and role IDs from Discord by name on startup.
 * No manual ID copying, no webhook setup — just run /setup once and
 * the bot finds everything it needs automatically.
 */

import { discord } from "./discord-api.js";
import { log } from "./logger.js";

// These are the exact names the bot creates and looks for
export const CHANNEL_NAMES = {
  hot:  "hot-restocks",
  all:  "all-restocks",
  logs: "bot-logs",
  pick: "pick-your-alerts"
};

export const ROLE_NAMES = {
  all:        "all-restocks",
  etb:        "etb-hunter",
  boosterBox: "booster-box-hunter",
  bundle:     "bundle-hunter",
  tin:        "tin-hunter",
  premium:    "premium-hunter",
  singles:    "singles-hunter"
};

export const ROLE_LABELS = {
  all:        "🔔 Everything",
  etb:        "🎁 Elite Trainer Boxes",
  boosterBox: "📦 Booster Boxes",
  bundle:     "🎴 Booster Bundles",
  tin:        "🥫 Tins",
  premium:    "⭐ Premium Collections",
  singles:    "🃏 Single Packs & Blisters"
};

export const ROLE_COLORS = {
  all:        0xffcb05,
  etb:        0xe74c3c,
  boosterBox: 0x3498db,
  bundle:     0x2ecc71,
  tin:        0xe67e22,
  premium:    0x9b59b6,
  singles:    0x95a5a6
};

export async function loadDiscordConfig() {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId || !process.env.DISCORD_BOT_TOKEN) {
    log.warn("DISCORD_GUILD_ID or DISCORD_BOT_TOKEN not set — Discord features disabled. Run /setup after setting these.");
    return null;
  }

  try {
    const [channels, roles] = await Promise.all([
      discord.getChannels(guildId),
      discord.getRoles(guildId)
    ]);

    const channelIds = {};
    for (const [key, name] of Object.entries(CHANNEL_NAMES)) {
      const ch = channels.find(c => c.name === name);
      if (ch) channelIds[key] = ch.id;
      else log.warn(`Channel #${name} not found — run /setup in Discord to create it`);
    }

    const roleIds = {};
    for (const [key, name] of Object.entries(ROLE_NAMES)) {
      const role = roles.find(r => r.name === name);
      if (role) roleIds[key] = role.id;
      else log.warn(`Role @${name} not found — run /setup in Discord to create it`);
    }

    const channelCount = Object.keys(channelIds).length;
    const roleCount = Object.keys(roleIds).length;
    log.info(`Discord config loaded: ${channelCount} channel(s), ${roleCount} role(s)`);

    return { guildId, channels: channelIds, roles: roleIds };
  } catch (err) {
    log.error("Failed to load Discord config:", err.message);
    return null;
  }
}
