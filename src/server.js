/**
 * HTTP server — handles Discord slash commands and button clicks.
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

import http from "http";
import { createPublicKey, verify } from "crypto";
import axios from "axios";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { discord } from "./discord-api.js";
import { runSetup, setupSummaryMessage } from "./setup.js";
import { ROLE_NAMES, loadDiscordConfig } from "./discord-config.js";
import { setUserLocation, getUsers, toggleRetailerPref } from "./users.js";
import { discoverProducts } from "./discover.js";
import { log } from "./logger.js";

// Kept in module scope so /setup can refresh it for subsequent /test calls
let _discordConfig = null;
export function getDiscordConfig() { return _discordConfig; }
export function setDiscordConfig(cfg) { _discordConfig = cfg; }

const __dir = dirname(fileURLToPath(import.meta.url));
const PRODUCTS_FILE = join(__dir, "../config/products.json");

// --- Discord Ed25519 signature verification (Node 18+ built-in crypto) ---
function verifySignature(publicKeyHex, signature, timestamp, rawBody) {
  try {
    const pubKey = createPublicKey({
      key: Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"),
        Buffer.from(publicKeyHex, "hex")
      ]),
      format: "der",
      type: "spki"
    });
    return verify(null, Buffer.from(timestamp + rawBody), pubKey, Buffer.from(signature, "hex"));
  } catch (err) {
    log.error("Signature verification error:", err.message);
    return false;
  }
}

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

function handleSetLocation(userId, username, options) {
  const zip = options.find(o => o.name === "zip")?.value;
  const radius = 25;

  if (!/^\d{5}$/.test(zip)) {
    return { content: "❌ Enter a valid 5-digit US zip code (e.g. `/setlocation 60614`).", flags: 64 };
  }

  setUserLocation(userId, username, zip, radius);
  return {
    content: `✅ Got it! You'll get alerts for stores within **25 miles of ${zip}**.\n\nIf you haven't already, head to <#pick-your-alerts> and click the buttons for what you want to be notified about.`,
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

  const byRetailer = Object.entries(botStats.nearbyStores ?? {})
    .filter(([, s]) => s.length > 0)
    .map(([r, s]) => `• **${r}**: ${s.length} store(s)`)
    .join("\n") || "No stores found yet — check your USER_ZIP env var";

  return {
    embeds: [{
      title: "📊 Bot Status",
      color: 0xffcb05,
      fields: [
        { name: "Products Tracked", value: String(products.length), inline: true  },
        { name: "Nearby Stores",    value: String(storeCount),      inline: true  },
        { name: "Users Set Up",     value: String(users.length),    inline: true  },
        { name: "Stores by Retailer", value: byRetailer,            inline: false },
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
      const { discord: discordCfg } = await import("./discord-config.js");
      // We'll load roles fresh to get IDs — simple approach
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
    await axios.put(
      `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`,
      commands,
      { headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" } }
    );
    log.info("Slash commands registered: /setup /setlocation /status /products /discover /test");
  } catch (err) {
    log.error("Failed to register slash commands:", err.response?.data ?? err.message);
  }
}

// --- HTTP server ---

export function startServer(botStats, initialConfig) {
  _discordConfig = initialConfig;
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  const port = process.env.PORT ?? 3000;

  if (!publicKey) {
    log.warn("DISCORD_PUBLIC_KEY not set — slash command server not started");
    return;
  }

  http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/interactions") {
      res.writeHead(404); res.end(); return;
    }

    let rawBody = "";
    req.on("data", chunk => { rawBody += chunk; });
    req.on("end", async () => {
      const sig = req.headers["x-signature-ed25519"];
      const ts  = req.headers["x-signature-timestamp"];

      if (!verifySignature(publicKey, sig, ts, rawBody)) {
        res.writeHead(401); res.end("Invalid signature"); return;
      }

      const body = JSON.parse(rawBody);
      res.setHeader("Content-Type", "application/json");

      // Discord PING
      if (body.type === 1) {
        res.writeHead(200); res.end(JSON.stringify({ type: 1 })); return;
      }

      const guildId  = body.guild_id;
      const userId   = body.member?.user?.id ?? body.user?.id;
      const username = body.member?.user?.username ?? body.user?.username;
      let responseData;

      // Slash command
      if (body.type === 2) {
        const { name, options = [] } = body.data;
        switch (name) {
          case "setup":       responseData = await handleSetup(guildId); break;
          case "setlocation": responseData = handleSetLocation(userId, username, options); break;
          case "status":      responseData = handleStatus(botStats); break;
          case "test":        responseData = await handleTest(_discordConfig); break;
          case "products":    responseData = handleProducts(); break;
          case "discover":    responseData = await handleDiscover(); break;
          default:            responseData = { content: "Unknown command.", flags: 64 };
        }
        res.writeHead(200);
        res.end(JSON.stringify({ type: 4, data: responseData }));
        return;
      }

      // Button click
      if (body.type === 3) {
        const customId = body.data.custom_id;
        responseData = await handleButtonClick(guildId, userId, username, customId);
        res.writeHead(200);
        res.end(JSON.stringify({ type: 4, data: responseData }));
        return;
      }

      res.writeHead(400); res.end();
    });
  }).listen(port, () => log.info(`Slash command server listening on port ${port}`));
}
