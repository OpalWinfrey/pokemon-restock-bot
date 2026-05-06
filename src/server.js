/**
 * Discord Gateway bot — handles slash commands and button clicks via WebSocket.
 *
 * Slash commands:
 *   /setup         — one-time server setup (creates channels, roles, button picker)
 *   /setlocation   — set your zip + radius so stores near YOU get checked
 *   /status        — see what the bot is tracking right now
 *   /test          — send a fake alert to confirm everything is wired up
 *
 * Button interactions (in #pick-your-alerts):
 *   Role toggle buttons — adds or removes an alert role for the user who clicked
 */

import { Client, GatewayIntentBits, REST, Routes } from "discord.js";
import axios from "axios";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { discord } from "./discord-api.js";
import { runSetup, setupSummaryMessage } from "./setup.js";
import { ROLE_NAMES, loadDiscordConfig } from "./discord-config.js";
import { setUserLocation, getUsers, toggleRetailerPref } from "./users.js";
import { addManualStore, removeManualStore, getManualStores } from "./stores.js";
import { discoverProducts } from "./discover.js";
import { log } from "./logger.js";

// Kept in module scope so /setup can refresh it for subsequent /test calls
let _discordConfig = null;
export function getDiscordConfig() { return _discordConfig; }
export function setDiscordConfig(cfg) { _discordConfig = cfg; }

let _botStats = null;
let _rebuildStoreMap = null;

const __dir = dirname(fileURLToPath(import.meta.url));
const PRODUCTS_FILE = join(__dir, "../config/products.json");

// --- Slash command handlers ---

async function handleSetup(guildId) {
  if (!guildId) return { content: "❌ This command must be run inside a Discord server.", flags: 64 };
  try {
    const { channels, roles } = await runSetup(guildId);
    // Reload config so /test and alerts work immediately without a restart
    _discordConfig = await loadDiscordConfig();
    // Kick off first product scan in background
    discoverProducts()
      .catch(err => log.error("Auto-discover after /setup failed:", err.message));
    return setupSummaryMessage(channels, roles);
  } catch (err) {
    log.error("Setup failed:", err.message);
    return { content: `❌ Setup failed: ${err.message}\n\nMake sure the bot has **Manage Channels** and **Manage Roles** permissions.`, flags: 64 };
  }
}

function handleSetLocation(userId, username, options, interaction) {
  const zip = options.find(o => o.name === "zip")?.value;
  const radius = 25;

  if (!/^\d{5}$/.test(zip)) {
    return { content: "❌ Enter a valid 5-digit US zip code (e.g. `/setlocation 60614`).", flags: 64 };
  }

  setUserLocation(userId, username, zip, radius);

  // Rebuild store map and follow up with exact counts once done
  if (_rebuildStoreMap) {
    _rebuildStoreMap().then(async storeMap => {
      if (_botStats) _botStats.nearbyStores = storeMap;

      const DISPLAY_NAMES = {
        target: "Target", walmart: "Walmart", costco: "Costco",
        samsclub: "Sam's Club", meijer: "Meijer", walgreens: "Walgreens", cvs: "CVS"
      };
      const found = Object.entries(storeMap)
        .filter(([, s]) => s.length > 0)
        .map(([r, s]) => `• **${DISPLAY_NAMES[r] ?? r}**: ${s.length} store(s)`);
      const total = Object.values(storeMap).flat().length;

      const followUpContent = total > 0
        ? `📍 Found **${total} store(s)** within ${radius} miles of \`${zip}\`:\n${found.join("\n")}`
        : `⚠️ No stores found within ${radius} miles of \`${zip}\`. The bot may still detect online-only drops.\n\nIf you're in a rural area, try a nearby larger city's zip.`;

      log.info(`Store map rebuilt for ${username} (${zip}): ${total} store(s)`);

      await interaction.followUp({ content: followUpContent, ephemeral: true })
        .catch(err => log.warn("setlocation follow-up failed:", err.message));
    }).catch(err => log.warn("Store map rebuild failed:", err.message));
  }

  return {
    content: `✅ Got it! Searching for stores within **${radius} miles of ${zip}**...`,
    flags: 64
  };
}

function handleStatus(botStats) {
  const products = JSON.parse(readFileSync(PRODUCTS_FILE, "utf8"));
  const users = getUsers();
  const storeCount = Object.values(botStats.nearbyStores ?? {}).flat().length;
  const lastCheck = botStats.lastCheckTime
    ? `<t:${Math.floor(botStats.lastCheckTime / 1000)}:R>`
    : "not yet";

  const DISPLAY_NAMES = {
    target: "Target", walmart: "Walmart", costco: "Costco",
    samsclub: "Sam's Club", meijer: "Meijer", walgreens: "Walgreens", cvs: "CVS"
  };
  const zip = process.env.USER_ZIP;
  const radius = process.env.SEARCH_RADIUS_MILES || "20";
  const byRetailer = Object.entries(botStats.nearbyStores ?? {})
    .map(([r, s]) => s.length ? `• **${DISPLAY_NAMES[r] ?? r}**: ${s.length} store(s)` : `• ~~${DISPLAY_NAMES[r] ?? r}~~ — 0 found`)
    .join("\n") || (zip ? "No stores found yet — try again in a moment" : "⚠️ USER_ZIP not set in Railway");

  return {
    embeds: [{
      title: "📊 Bot Status",
      color: 0xffcb05,
      fields: [
        { name: "Products Tracked", value: String(products.length), inline: true  },
        { name: "Nearby Stores",    value: String(storeCount),      inline: true  },
        { name: "Users Set Up",     value: String(users.length),    inline: true  },
        { name: `Stores within ${radius}mi of ${zip ?? "⚠️ USER_ZIP not set"}`, value: byRetailer, inline: false },
        { name: "Last Check",       value: lastCheck,               inline: false }
      ],
      timestamp: new Date().toISOString(),
      footer: { text: "Pokemon Restock Bot" }
    }]
  };
}

async function handleTest(discordConfig) {
  if (!discordConfig?.channels?.all) {
    return { content: "❌ Bot isn't fully set up yet — run `/setup` first.", flags: 64 };
  }

  try {
    await discord.sendMessage(discordConfig.channels.all, {
      embeds: [{
        title: "🧪 Test Alert — Pokemon Restock Bot",
        color: 0x00cc88,
        description: "If you can see this, alerts are working correctly!",
        fields: [
          { name: "Product",  value: "Pokemon Prismatic Evolutions ETB (TEST)", inline: false },
          { name: "Retailer", value: "Target",                                  inline: true  },
          { name: "Store",    value: "Test Store — 123 Main St, Chicago, IL",   inline: true  },
          { name: "Price",    value: "$49.99 ✅ MSRP",                           inline: true  }
        ],
        timestamp: new Date().toISOString(),
        footer: { text: "Pokemon Restock Bot — Test Mode" }
      }]
    });
    return { content: `✅ Test alert sent to <#${discordConfig.channels.all}>!`, flags: 64 };
  } catch (err) {
    return { content: `❌ Couldn't send test alert: ${err.message}`, flags: 64 };
  }
}

function handleAddProduct(options) {
  const retailer = options.find(o => o.name === "retailer")?.value;
  const url      = options.find(o => o.name === "url")?.value;
  if (!retailer || !url) return { content: "❌ Both retailer and URL are required.", flags: 64 };

  // Extract item ID from URL based on retailer
  const PATTERNS = {
    target:    /\/A-(\d+)/,
    walmart:   /\/ip\/(?:[^/]+\/)?(\d+)/,
    costco:    /\.product\.(\d+)/,
    samsclub:  /\/p\/[^/]+\/([A-Za-z0-9]+)(?:\?|$)/,
    meijer:    /\/p\/([^/?]+)/,
    walgreens: /prod(\d+)/,
    cvs:       /prodid=([^&]+)/
  };

  const pattern = PATTERNS[retailer];
  if (!pattern) return { content: `❌ Unknown retailer "${retailer}".`, flags: 64 };

  const match = url.match(pattern);
  if (!match) return { content: `❌ Couldn't extract a product ID from that URL. Make sure it's a direct product page URL.`, flags: 64 };

  const itemId = match[1];

  let products = [];
  try { products = JSON.parse(readFileSync(PRODUCTS_FILE, "utf8")); } catch { /* empty */ }

  // Check if this retailer+id combo already exists
  const alreadyExists = products.some(p => p.retailers[retailer]?.itemId === itemId ||
    p.retailers[retailer]?.tcin === itemId || p.retailers[retailer]?.sku === itemId ||
    p.retailers[retailer]?.upc === itemId);

  if (alreadyExists) return { content: `⚠️ That product is already being tracked.`, flags: 64 };

  // Add as a new product entry — name will be filled in on next discovery run
  const KEY_NAMES = { target: "tcin", walmart: "itemId", costco: "itemNumber", samsclub: "itemId", meijer: "itemId", walgreens: "sku", cvs: "upc" };
  const newProduct = {
    name: `Manual entry — ${retailer} ${itemId}`,
    imageUrl: null, msrp: null,
    retailers: { [retailer]: { [KEY_NAMES[retailer] ?? "itemId"]: itemId, url } }
  };

  products.push(newProduct);
  try {
    writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2) + "\n");
    return { content: `✅ Added **${retailer}** product \`${itemId}\` — it will be checked on the next poll cycle.`, flags: 64 };
  } catch (err) {
    return { content: `❌ Failed to save: ${err.message}`, flags: 64 };
  }
}

function handleProducts() {
  let existing = [];
  try { existing = JSON.parse(readFileSync(PRODUCTS_FILE, "utf8")); } catch { /* empty */ }

  if (!existing.length) {
    return { content: "No products tracked yet — run `/discover` to kick off the first scan.", flags: 64 };
  }

  const lines = existing.map(p => {
    const retailers = Object.keys(p.retailers).join(", ");
    const msrp = p.msrp ? ` — MSRP $${p.msrp.toFixed(2)}` : "";
    return `• **${p.name}**${msrp} _(${retailers})_`;
  });

  // Discord has a 2000 char message limit — split into chunks if needed
  const chunks = [];
  let current = "";
  for (const line of lines) {
    if (current.length + line.length + 1 > 1900) {
      chunks.push(current);
      current = "";
    }
    current += (current ? "\n" : "") + line;
  }
  if (current) chunks.push(current);

  return {
    content: `**Tracking ${existing.length} product(s):**\n\n${chunks[0]}${chunks.length > 1 ? `\n\n_...and ${existing.length - chunks[0].split("\n").length} more_` : ""}`
  };
}

function handleStores() {
  const storeMap = _botStats?.nearbyStores ?? {};
  const manualStores = Object.entries(storeMap).filter(([, s]) => s.length > 0);

  const onlineLines = [
    "🌐 **Online stock monitored automatically:**",
    "  • Target.com",
    "  • Walmart.com",
    "  • Pokemon Center (pokemoncenter.com)",
    ""
  ];

  if (!manualStores.length) {
    return {
      content: [
        ...onlineLines,
        "🏪 **In-store monitoring:** none set up yet",
        "Retailer store locator APIs block cloud servers, so we can't look up stores automatically.",
        "If you want in-store alerts, ask the server owner to add store IDs manually."
      ].join("\n"),
      flags: 64
    };
  }

  const DISPLAY_NAMES = {
    target: "Target", walmart: "Walmart", costco: "Costco",
    samsclub: "Sam's Club", meijer: "Meijer", walgreens: "Walgreens", cvs: "CVS"
  };
  const storeLines = [];
  for (const [retailerKey, stores] of manualStores) {
    storeLines.push(`**${DISPLAY_NAMES[retailerKey] ?? retailerKey}** (${stores.length})`);
    for (const s of stores) storeLines.push(`  • ${s.name}${s.address ? ` — ${s.address}` : ""}`);
  }
  const total = manualStores.reduce((n, [, s]) => n + s.length, 0);

  const content = [...onlineLines, `🏪 **${total} manual store(s):**`, ...storeLines].join("\n");
  return { content: content.length > 1950 ? content.slice(0, 1947) + "..." : content, flags: 64 };
}

function handleAddStore(options) {
  const retailer  = options.find(o => o.name === "retailer")?.value;
  const storeId   = options.find(o => o.name === "store_id")?.value?.trim();
  const storeName = options.find(o => o.name === "store_name")?.value?.trim();

  if (!retailer || !storeId) {
    return { content: "❌ Retailer and store ID are required.", flags: 64 };
  }

  const DISPLAY_NAMES = { target: "Target", walmart: "Walmart", costco: "Costco",
    samsclub: "Sam's Club", meijer: "Meijer", walgreens: "Walgreens", cvs: "CVS" };
  const label = DISPLAY_NAMES[retailer] ?? retailer;
  const name = storeName || `${label} #${storeId}`;

  const result = addManualStore({ retailer, storeId, storeName: name });
  if (!result.added) {
    return { content: `⚠️ Already tracking: **${result.reason}**`, flags: 64 };
  }

  // Rebuild store map so the next poll cycle picks it up
  if (_rebuildStoreMap) {
    _rebuildStoreMap().then(map => { if (_botStats) _botStats.nearbyStores = map; }).catch(() => {});
  }

  return {
    content: [
      `✅ Added **${name}** (${label} store #${storeId})`,
      `The next check cycle will test if in-store availability works from Railway's IP.`,
      `Watch #bot-logs — if you see \`Out of stock: ... at ${name}\` it's working. A 403/412 error means it's blocked.`
    ].join("\n"),
    flags: 64
  };
}

function handleRemoveStore(options) {
  const retailer = options.find(o => o.name === "retailer")?.value;
  const storeId  = options.find(o => o.name === "store_id")?.value?.trim();

  if (!retailer || !storeId) {
    return { content: "❌ Retailer and store ID are required.", flags: 64 };
  }

  const result = removeManualStore({ retailer, storeId });
  if (!result.removed) {
    return { content: `⚠️ Store #${storeId} not found in the list.`, flags: 64 };
  }

  if (_rebuildStoreMap) {
    _rebuildStoreMap().then(map => { if (_botStats) _botStats.nearbyStores = map; }).catch(() => {});
  }

  return { content: `✅ Removed store #${storeId} from monitoring.`, flags: 64 };
}

async function handleDiscover() {
  // Fire off discovery in background and respond immediately
  discoverProducts()
    .then(products => log.info(`/discover triggered — found ${products.length} products`))
    .catch(err => log.error("/discover failed:", err.message));

  return {
    content: "🔍 Discovery started! This takes 1–2 minutes. Run `/products` afterwards to see what was found.",
    flags: 64
  };
}

// --- Button interaction handler ---
// Toggles an alert role on/off for the user who clicked

async function handleButtonClick(guildId, userId, username, customId) {
  if (!guildId || !userId) return { content: "Something went wrong.", flags: 64 };

  // "role_removeAll" clears every alert role
  if (customId === "role_removeAll") {
    try {
      const member = await discord.getMember(guildId, userId);
      const roles = await discord.getRoles(guildId);
      const alertRoleNames = Object.values(ROLE_NAMES);
      const alertRoles = roles.filter(r => alertRoleNames.includes(r.name));

      for (const role of alertRoles) {
        if (member.roles.includes(role.id)) {
          await discord.removeRole(guildId, userId, role.id);
        }
      }
      return { content: "🔕 Removed all your alert roles.", flags: 64 };
    } catch (err) {
      log.error("Failed to remove all roles:", err.message);
      return { content: "❌ Something went wrong removing your roles.", flags: 64 };
    }
  }

  // "retailer_target", "retailer_walmart", etc.
  if (customId.startsWith("retailer_")) {
    const retailerKey = customId.replace("retailer_", "");
    const RETAILER_LABELS = {
      target: "Target", walmart: "Walmart", costco: "Costco",
      gamestop: "GameStop", samsclub: "Sam's Club",
      meijer: "Meijer", walgreens: "Walgreens", cvs: "CVS"
    };
    const label = RETAILER_LABELS[retailerKey] ?? retailerKey;
    try {
      const nowEnabled = toggleRetailerPref(userId, username, retailerKey);
      return nowEnabled
        ? { content: `✅ **${label}** alerts turned ON — you'll be pinged for restocks there.`, flags: 64 }
        : { content: `🔕 **${label}** alerts turned OFF — you won't be pinged for that store anymore.`, flags: 64 };
    } catch (err) {
      log.error(`Failed to toggle retailer ${retailerKey}:`, err.message);
      return { content: "❌ Something went wrong updating your retailer preference.", flags: 64 };
    }
  }

  // "role_etb", "role_boosterBox", etc.
  const categoryKey = customId.replace("role_", "");
  const roleName = ROLE_NAMES[categoryKey];
  if (!roleName) return { content: "Unknown role.", flags: 64 };

  try {
    const [member, allRoles] = await Promise.all([
      discord.getMember(guildId, userId),
      discord.getRoles(guildId)
    ]);

    const role = allRoles.find(r => r.name === roleName);
    if (!role) return { content: "❌ Role not found — try running `/setup` again.", flags: 64 };

    const hasRole = member.roles.includes(role.id);

    if (hasRole) {
      await discord.removeRole(guildId, userId, role.id);
      return { content: `🔕 Removed **${roleName}** — you won't be pinged for those anymore.`, flags: 64 };
    } else {
      await discord.addRole(guildId, userId, role.id);
      return { content: `✅ You now have **${roleName}** — you'll be pinged when those restock!`, flags: 64 };
    }
  } catch (err) {
    log.error(`Failed to toggle role ${roleName}:`, err.message);
    return { content: "❌ Couldn't update your role. Make sure the bot has **Manage Roles** permission.", flags: 64 };
  }
}

// --- Slash command registration ---

export async function registerSlashCommands() {
  const appId = process.env.DISCORD_APP_ID;
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!appId || !token) return;

  const commands = [
    {
      name: "setup",
      description: "One-time setup — creates channels, roles, and the alert picker. Run this first."
    },
    {
      name: "setlocation",
      description: "Set your zip code to get alerts for stores near you",
      options: [
        { type: 3, name: "zip", description: "Your 5-digit US zip code (e.g. 60614)", required: true }
      ]
    },
    {
      name: "status",
      description: "See what the bot is currently tracking"
    },
    {
      name: "products",
      description: "List all Pokemon products the bot is currently monitoring"
    },
    {
      name: "addproduct",
      description: "Manually add a product from Sam's Club, Meijer, or any store URL",
      options: [
        {
          type: 3, name: "retailer", description: "Which store", required: true,
          choices: [
            { name: "Sam's Club", value: "samsclub" },
            { name: "Meijer",     value: "meijer"   },
            { name: "Costco",     value: "costco"   },
            { name: "Walgreens",  value: "walgreens"},
            { name: "CVS",        value: "cvs"      },
            { name: "Target",     value: "target"   },
            { name: "Walmart",    value: "walmart"  }
          ]
        },
        { type: 3, name: "url", description: "Direct product page URL", required: true }
      ]
    },
    {
      name: "stores",
      description: "Show all stores currently being monitored and their locations"
    },
    {
      name: "addstore",
      description: "Manually add a store for in-store stock checking (get store ID from the retailer's website)",
      options: [
        {
          type: 3, name: "retailer", description: "Which retailer", required: true,
          choices: [
            { name: "Target",     value: "target"   },
            { name: "Walmart",    value: "walmart"  },
            { name: "Costco",     value: "costco"   },
            { name: "Sam's Club", value: "samsclub" },
            { name: "Meijer",     value: "meijer"   }
          ]
        },
        { type: 3, name: "store_id",   description: "Store ID number (from the store's URL on their website)", required: true },
        { type: 3, name: "store_name", description: "Friendly name (e.g. 'Target Cincinnati Eastgate')", required: false }
      ]
    },
    {
      name: "removestore",
      description: "Remove a manually-added store from monitoring",
      options: [
        {
          type: 3, name: "retailer", description: "Which retailer", required: true,
          choices: [
            { name: "Target",     value: "target"   },
            { name: "Walmart",    value: "walmart"  },
            { name: "Costco",     value: "costco"   },
            { name: "Sam's Club", value: "samsclub" },
            { name: "Meijer",     value: "meijer"   }
          ]
        },
        { type: 3, name: "store_id", description: "Store ID number to remove", required: true }
      ]
    },
    {
      name: "discover",
      description: "Manually trigger a product discovery scan right now"
    },
    {
      name: "test",
      description: "Send a fake restock alert to confirm everything is working"
    }
  ];

  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) {
    log.warn("DISCORD_GUILD_ID not set — skipping slash command registration");
    return;
  }

  try {
    const rest = new REST({ version: "10" }).setToken(token);
    await rest.put(
      Routes.applicationGuildCommands(appId, guildId),
      { body: commands }
    );
    log.info("Slash commands registered: /setup /setlocation /status /products /stores /discover /test");
  } catch (err) {
    log.error("Failed to register slash commands:", err.response?.data ?? err.message);
  }
}

// --- Discord Gateway bot ---

export function startBot(botStats, initialConfig, rebuildStoreMap) {
  _discordConfig = initialConfig;
  _botStats = botStats;
  if (rebuildStoreMap) _rebuildStoreMap = rebuildStoreMap;

  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    log.warn("DISCORD_BOT_TOKEN not set — bot not started");
    return;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds
    ]
  });

  client.once("ready", () => {
    log.info(`Discord Gateway connected — logged in as ${client.user.tag}`);
  });

  client.on("interactionCreate", async interaction => {
    try {
      const guildId  = interaction.guildId;
      const userId   = interaction.user?.id;
      const username = interaction.user?.username;

      // Slash command
      if (interaction.isChatInputCommand()) {
        const name = interaction.commandName;
        const rawOptions = interaction.options.data.map(opt => ({ name: opt.name, value: opt.value }));

        let responseData;

        // /setlocation sends an immediate ack then a follow-up after async store lookup
        if (name === "setlocation") {
          await interaction.deferReply({ ephemeral: true });
          responseData = handleSetLocation(userId, username, rawOptions, interaction);
          await interaction.editReply(responseData);
          return;
        }

        switch (name) {
          case "setup":       responseData = await handleSetup(guildId); break;
          case "status":      responseData = handleStatus(botStats); break;
          case "test":        responseData = await handleTest(_discordConfig); break;
          case "products":    responseData = handleProducts(); break;
          case "stores":      responseData = handleStores(); break;
          case "addstore":    responseData = handleAddStore(rawOptions); break;
          case "removestore": responseData = handleRemoveStore(rawOptions); break;
          case "addproduct":  responseData = handleAddProduct(rawOptions); break;
          case "discover":    responseData = await handleDiscover(); break;
          default:            responseData = { content: "Unknown command.", flags: 64 };
        }

        // flags: 64 = ephemeral in the HTTP model; use ephemeral: true for discord.js
        const ephemeral = Boolean(responseData.flags & 64);
        const reply = { ...responseData };
        delete reply.flags;
        await interaction.reply({ ...reply, ephemeral });
        return;
      }

      // Button click
      if (interaction.isButton()) {
        const customId = interaction.customId;
        const responseData = await handleButtonClick(guildId, userId, username, customId);
        const ephemeral = Boolean(responseData.flags & 64);
        const reply = { ...responseData };
        delete reply.flags;
        await interaction.reply({ ...reply, ephemeral });
        return;
      }
    } catch (err) {
      log.error("interactionCreate error:", err.message);
      try {
        const msg = { content: "❌ Something went wrong processing that interaction.", ephemeral: true };
        if (interaction.deferred) await interaction.editReply(msg);
        else if (!interaction.replied) await interaction.reply(msg);
      } catch { /* ignore reply errors */ }
    }
  });

  client.on("error", err => log.error("Discord client error:", err.message));

  client.login(token).catch(err => {
    log.error("Failed to login to Discord Gateway:", err.message);
    process.exit(1);
  });

  return client;
}

// Backwards-compatible alias so existing index.js import keeps working
export { startBot as startServer };
