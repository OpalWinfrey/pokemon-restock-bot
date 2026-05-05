/**
 * /setup command — run this once in your Discord server.
 * Creates all channels, roles, and posts the click-to-subscribe button message.
 * Nothing to configure manually.
 */

import { discord } from "./discord-api.js";
import { log } from "./logger.js";
import { CHANNEL_NAMES, ROLE_NAMES, ROLE_LABELS, ROLE_COLORS } from "./discord-config.js";

async function ensureChannel(guildId, existing, name) {
  const found = existing.find(c => c.name === name);
  if (found) return found;
  log.info(`Creating channel #${name}`);
  return discord.createChannel(guildId, { name, type: 0 }); // type 0 = text channel
}

async function ensureRole(guildId, existing, name, color) {
  const found = existing.find(r => r.name === name);
  if (found) return found;
  log.info(`Creating role @${name}`);
  return discord.createRole(guildId, { name, color, mentionable: true });
}

function buildPickerMessage(roleIds) {
  return {
    content: [
      "## 🎴 Pokemon Restock Alerts",
      "**Click a button to get pinged when that type of product restocks.**",
      "Click it again to remove the alert. You can pick as many as you want.",
      "",
      "New sets are detected automatically — you don't need to do anything when a new set drops."
    ].join("\n"),
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 1, label: "🎁 ETB",             custom_id: "role_etb"        },
          { type: 2, style: 1, label: "📦 Booster Boxes",   custom_id: "role_boosterBox" },
          { type: 2, style: 2, label: "🎴 Bundles",         custom_id: "role_bundle"     },
          { type: 2, style: 2, label: "🥫 Tins",            custom_id: "role_tin"        },
          { type: 2, style: 1, label: "⭐ Premium",          custom_id: "role_premium"    }
        ]
      },
      {
        type: 1,
        components: [
          { type: 2, style: 3, label: "🔔 Everything",      custom_id: "role_all"        },
          { type: 2, style: 2, label: "🃏 Singles & Packs", custom_id: "role_singles"    },
          { type: 2, style: 4, label: "🔕 Remove All",      custom_id: "role_removeAll"  }
        ]
      }
    ]
  };
}

export async function runSetup(guildId) {
  log.info("Running Discord setup for guild", guildId);

  const [existingChannels, existingRoles] = await Promise.all([
    discord.getChannels(guildId),
    discord.getRoles(guildId)
  ]);

  // Create all channels
  const channels = {};
  for (const [key, name] of Object.entries(CHANNEL_NAMES)) {
    const ch = await ensureChannel(guildId, existingChannels, name);
    channels[key] = ch.id;
  }

  // Create all alert roles
  const roles = {};
  for (const [key, name] of Object.entries(ROLE_NAMES)) {
    const role = await ensureRole(guildId, existingRoles, name, ROLE_COLORS[key] ?? 0);
    roles[key] = role.id;
  }

  // Post (or re-post) the role picker in #pick-your-alerts
  await discord.sendMessage(channels.pick, buildPickerMessage(roles));

  log.info("Setup complete");
  return { channels, roles };
}

export function setupSummaryMessage(channels, roles) {
  const lines = [
    "✅ **Setup complete!** Here's what was created:\n",
    "**Channels:**",
    `• <#${channels.hot}> — ETBs, booster boxes, premium collections`,
    `• <#${channels.all}> — everything else`,
    `• <#${channels.logs}> — bot errors and warnings (keep this private)`,
    `• <#${channels.pick}> — where people click to pick their alerts\n`,
    "**Roles:** all-restocks, etb-hunter, booster-box-hunter, bundle-hunter, tin-hunter, premium-hunter, singles-hunter\n",
    "**Next steps:**",
    "1. Tell your friends to go to <#" + channels.pick + "> and click the buttons for what they want",
    "2. Everyone runs `/setlocation <zip> <radius>` so the bot checks stores near them",
    "3. That's it — the bot handles everything else automatically"
  ];
  return { content: lines.join("\n"), flags: 64 };
}
