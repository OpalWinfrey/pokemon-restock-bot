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
      "Tap what you want to be pinged for. Tap again to turn it off.",
      "",
      "> ETB = Elite Trainer Box · Premium = special & ultra collections",
    ].join("\n"),
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 2, label: "🎁 ETB",             custom_id: "role_etb"        },
          { type: 2, style: 2, label: "📦 Booster Boxes",   custom_id: "role_boosterBox" },
          { type: 2, style: 2, label: "🎴 Bundles",         custom_id: "role_bundle"     },
          { type: 2, style: 2, label: "🥫 Tins",            custom_id: "role_tin"        },
          { type: 2, style: 2, label: "⭐ Premium",          custom_id: "role_premium"    }
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

function buildHelpMessage() {
  return {
    embeds: [{
      title: "🤖 Pokemon Restock Bot — Commands",
      color: 0xffcb05,
      description: "The bot monitors Target and Walmart for Pokemon card restocks. Additional stores (Sam's Club, Meijer, etc.) can be added manually via `/addproduct`.",
      fields: [
        {
          name: "📍 Set Your Location",
          value: "`/setlocation [zip]`\nExample: `/setlocation 60614`\nThe bot will check stores within 25 miles of your zip code.",
          inline: false
        },
        {
          name: "🔔 Pick Your Alerts",
          value: `Go to <#pick-your-alerts> and tap what you want. Tap again to turn it off. All stores are on by default — tap a store button to mute it.`,
          inline: false
        },
        {
          name: "📦 See Tracked Products",
          value: "`/products`\nShows every Pokemon product the bot is currently monitoring across all retailers.",
          inline: false
        },
        {
          name: "🏪 See Monitored Stores",
          value: "`/stores`\nLists every store the bot is currently checking, grouped by retailer.",
          inline: false
        },
        {
          name: "📊 Bot Status",
          value: "`/status`\nShows how many products and stores are being monitored, and when the last check ran.",
          inline: false
        },
        {
          name: "🔍 Force Product Scan",
          value: "`/discover`\nManually triggers a fresh scan for new Pokemon products. Normally runs automatically every 12 hours.",
          inline: false
        },
        {
          name: "📺 Channels",
          value: [
            "🔥 **#hot-restocks** — ETBs, booster boxes, premium collections",
            "📋 **#all-restocks** — everything else",
            "🎛️ **#pick-your-alerts** — choose what you want to be pinged for",
            "📛 **#out-of-print** — sets the bot detected as no longer in production"
          ].join("\n"),
          inline: false
        }
      ],
      footer: { text: "New sets are detected automatically — no setup needed when new Pokemon sets drop." }
    }]
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

  // Post help message in #bot-commands
  await discord.sendMessage(channels.help, buildHelpMessage());

  // Post explanation in #out-of-print
  await discord.sendMessage(channels.outOfPrint, {
    embeds: [{
      title: "📛 Out-of-Print Products",
      color: 0x95a5a6,
      description: [
        "This channel lists Pokemon products the bot detected as **no longer in active production**.",
        "",
        "**How it works:**",
        "When the bot finds a product selling for more than **2× its MSRP** at every retailer, it flags it as likely out of print. These products are still tracked in case they restock at normal price — but you won't get pinged for reseller-priced stock.",
        "",
        "**Examples:**",
        "• Pokémon 151 ETB was $49.99 MSRP — if it only shows at $300+ it's flagged here",
        "• Silver Tempest ETBs at $89+ = likely reseller only",
        "",
        "**Note:** Products found on the official Pokemon Center store are always treated as in-print regardless of price elsewhere."
      ].join("\n"),
      footer: { text: "This list updates automatically every 12 hours during product discovery." }
    }]
  });

  log.info("Setup complete");
  return { channels, roles };
}

export function setupSummaryMessage(channels, roles) {
  const lines = [
    "✅ **Setup complete!** Here's what was created:\n",
    "**Channels:**",
    `• <#${channels.hot}> — ETBs, booster boxes, premium collections`,
    `• <#${channels.all}> — everything else`,
    `• <#${channels.pick}> — where people click to pick their alerts`,
    `• <#${channels.help}> — bot commands and instructions`,
    `• <#${channels.logs}> — bot errors and warnings (keep this private)\n`,
    "**Roles:** all-restocks, etb-hunter, booster-box-hunter, bundle-hunter, tin-hunter, premium-hunter, singles-hunter\n",
    "**Next steps:**",
    `1. Send your friends to <#${channels.help}> — everything they need is there`,
    `2. Everyone goes to <#${channels.pick}> and clicks what they want`,
    "3. Everyone runs `/setlocation <zip>` to get alerts for their area",
    "4. Run `/discover` to kick off the first product scan"
  ];
  return { content: lines.join("\n"), flags: 64 };
}
