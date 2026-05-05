/**
 * HTTP server that handles Discord slash command interactions.
 * Required env vars: DISCORD_APP_ID, DISCORD_BOT_TOKEN, DISCORD_PUBLIC_KEY
 *
 * Slash commands:
 *   /status           — show what the bot is tracking
 *   /setlocation      — set your zip code and search radius
 *   /subscribe        — get pinged when a specific product restocks
 *   /unsubscribe      — stop getting pinged for a product
 *   /subscriptions    — list your current subscriptions
 *   /test             — send a fake restock alert to verify webhook + channel setup
 */

import http from "http";
import { createPublicKey, verify } from "crypto";
import axios from "axios";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { setUserLocation, addSubscription, removeSubscription, getUsers } from "./users.js";
import { log } from "./logger.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const PRODUCTS_FILE = join(__dir, "../config/products.json");

// Discord Ed25519 signature verification (no external deps — Node 18+ built-in crypto)
function verifyDiscordSignature(publicKeyHex, signature, timestamp, rawBody) {
  try {
    const pubKey = createPublicKey({
      key: Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"), // Ed25519 SPKI prefix
        Buffer.from(publicKeyHex, "hex")
      ]),
      format: "der",
      type: "spki"
    });
    return verify(null, Buffer.from(timestamp + rawBody), pubKey, Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

// Register all slash commands with Discord on startup
export async function registerSlashCommands() {
  const appId = process.env.DISCORD_APP_ID;
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!appId || !token) return;

  const commands = [
    {
      name: "status",
      description: "Show what the bot is currently tracking"
    },
    {
      name: "setlocation",
      description: "Set your zip code so you get alerts for stores near you",
      options: [
        { type: 3, name: "zip", description: "Your zip code", required: true },
        { type: 4, name: "radius", description: "Search radius in miles (default: 20)", required: false }
      ]
    },
    {
      name: "subscribe",
      description: "Get pinged when a specific product restocks",
      options: [
        { type: 3, name: "product", description: "Product name or keyword (e.g. Prismatic Evolutions, ETB)", required: true }
      ]
    },
    {
      name: "unsubscribe",
      description: "Stop getting pinged for a product",
      options: [
        { type: 3, name: "product", description: "The keyword you subscribed with", required: true }
      ]
    },
    {
      name: "subscriptions",
      description: "List your current product subscriptions"
    },
    {
      name: "test",
      description: "Send a fake restock alert to verify your webhook and channel setup"
    }
  ];

  try {
    await axios.put(
      `https://discord.com/api/v10/applications/${appId}/commands`,
      commands,
      { headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" } }
    );
    log.info("Discord slash commands registered");
  } catch (err) {
    log.error("Failed to register slash commands:", err.response?.data ?? err.message);
  }
}

// --- Command handlers ---

function handleStatus(botStats) {
  const products = JSON.parse(readFileSync(PRODUCTS_FILE, "utf8"));
  const users = getUsers();
  const storeCount = Object.values(botStats.nearbyStores ?? {}).flat().length;
  const lastCheck = botStats.lastCheckTime
    ? `<t:${Math.floor(botStats.lastCheckTime / 1000)}:R>`
    : "not yet";

  const retailerBreakdown = Object.entries(botStats.nearbyStores ?? {})
    .filter(([, stores]) => stores.length > 0)
    .map(([retailer, stores]) => `• **${retailer}**: ${stores.length} store(s)`)
    .join("\n");

  return {
    embeds: [{
      title: "📊 Pokemon Restock Bot — Status",
      color: 0xffcb05,
      fields: [
        { name: "Products Tracked", value: String(products.length), inline: true },
        { name: "Nearby Stores", value: String(storeCount), inline: true },
        { name: "Users Registered", value: String(users.length), inline: true },
        { name: "Stores by Retailer", value: retailerBreakdown || "None found yet", inline: false },
        { name: "Last Check", value: lastCheck, inline: true }
      ],
      footer: { text: "Pokemon Restock Bot" },
      timestamp: new Date().toISOString()
    }]
  };
}

function handleSetLocation(userId, username, options) {
  const zip = options.find(o => o.name === "zip")?.value;
  const radius = options.find(o => o.name === "radius")?.value ?? 20;

  if (!/^\d{5}$/.test(zip)) {
    return { content: "❌ Invalid zip code — enter a 5-digit US zip (e.g. `90210`).", flags: 64 };
  }

  setUserLocation(userId, username, zip, Number(radius));
  return {
    content: `✅ Location set to ZIP **${zip}** with a **${radius}-mile** radius. You'll get alerts for stores near you.`,
    flags: 64 // ephemeral — only visible to the user
  };
}

function handleSubscribe(userId, username, options) {
  const keyword = options.find(o => o.name === "product")?.value ?? "";
  if (!keyword.trim()) return { content: "❌ Please enter a product keyword.", flags: 64 };

  const added = addSubscription(userId, username, keyword);
  return {
    content: added
      ? `✅ Subscribed! You'll be pinged whenever a product matching **"${keyword}"** restocks.`
      : `ℹ️ You're already subscribed to **"${keyword}"**.`,
    flags: 64
  };
}

function handleUnsubscribe(userId, username, options) {
  const keyword = options.find(o => o.name === "product")?.value ?? "";
  const removed = removeSubscription(userId, keyword);
  return {
    content: removed
      ? `✅ Unsubscribed from **"${keyword}"**.`
      : `ℹ️ You don't have a subscription for **"${keyword}"**.`,
    flags: 64
  };
}

async function handleTest() {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return { content: "❌ `DISCORD_WEBHOOK_URL` is not set in your environment.", flags: 64 };

  try {
    await axios.post(webhookUrl, {
      embeds: [{
        title: "🧪 TEST ALERT — Pokemon Restock Bot",
        color: 0x00cc88,
        description: "This is a test alert. If you can see this, your webhook and channel are set up correctly!",
        fields: [
          { name: "Product",  value: "Pokemon Prismatic Evolutions ETB (TEST)", inline: false },
          { name: "Retailer", value: "Target",                                  inline: true  },
          { name: "Store",    value: "Test Store — 123 Main St",                inline: true  },
          { name: "Price",    value: "$49.99 (MSRP ✅)",                         inline: true  }
        ],
        timestamp: new Date().toISOString(),
        footer: { text: "Pokemon Restock Bot — Test Mode" }
      }]
    });
    return { content: "✅ Test alert sent! Check your restock channel.", flags: 64 };
  } catch (err) {
    return { content: `❌ Failed to send test alert: ${err.message}`, flags: 64 };
  }
}

function handleSubscriptions(userId) {
  const users = getUsers();
  const user = users.find(u => u.discordUserId === userId);
  const subs = user?.subscriptions ?? [];

  if (subs.length === 0) {
    return {
      content: "You have no subscriptions yet. Use `/subscribe <product>` to get pinged for specific products.",
      flags: 64
    };
  }

  return {
    content: `**Your subscriptions:**\n${subs.map(s => `• ${s}`).join("\n")}\n\nUse \`/unsubscribe <keyword>\` to remove one.`,
    flags: 64
  };
}

// --- HTTP server ---

export function startServer(botStats) {
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  const port = process.env.PORT ?? 3000;

  if (!publicKey) {
    console.warn("⚠️  DISCORD_PUBLIC_KEY not set — slash command server not started.");
    return;
  }

  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/interactions") {
      res.writeHead(404);
      res.end();
      return;
    }

    let rawBody = "";
    req.on("data", chunk => { rawBody += chunk; });
    req.on("end", () => {
      const signature = req.headers["x-signature-ed25519"];
      const timestamp = req.headers["x-signature-timestamp"];

      if (!verifyDiscordSignature(publicKey, signature, timestamp, rawBody)) {
        res.writeHead(401);
        res.end("Invalid signature");
        return;
      }

      const body = JSON.parse(rawBody);
      res.setHeader("Content-Type", "application/json");

      // Discord PING handshake
      if (body.type === 1) {
        res.writeHead(200);
        res.end(JSON.stringify({ type: 1 }));
        return;
      }

      // Slash command
      if (body.type === 2) {
        const { name, options = [] } = body.data;
        const userId = body.member?.user?.id ?? body.user?.id;
        const username = body.member?.user?.username ?? body.user?.username;

        let responseData;
        switch (name) {
          case "status":        responseData = handleStatus(botStats); break;
          case "setlocation":   responseData = handleSetLocation(userId, username, options); break;
          case "subscribe":     responseData = handleSubscribe(userId, username, options); break;
          case "unsubscribe":   responseData = handleUnsubscribe(userId, username, options); break;
          case "subscriptions": responseData = handleSubscriptions(userId); break;
          case "test":          responseData = await handleTest(); break;
          default:
            responseData = { content: "Unknown command.", flags: 64 };
        }

        res.writeHead(200);
        res.end(JSON.stringify({ type: 4, data: responseData }));
        return;
      }

      res.writeHead(400);
      res.end();
    });
  });

  server.listen(port, () => {
    console.log(`🌐 Slash command server listening on port ${port}`);
  });
}
