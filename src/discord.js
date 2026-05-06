import { discord } from "./discord-api.js";
import { getProductCategories, isHotProduct, getReferenceMsrp } from "./classify.js";
import { userWantsRetailer } from "./users.js";
import { log } from "./logger.js";

const lastAlertAt = {};

function cooldownKey(productName, retailer, storeId) {
  return `${productName}__${retailer}__${storeId}`;
}

function isOnCooldown(productName, retailer, storeId) {
  const ms = parseInt(process.env.ALERT_COOLDOWN_MINUTES ?? "60") * 60 * 1000;
  const last = lastAlertAt[cooldownKey(productName, retailer, storeId)];
  return last && Date.now() - last < ms;
}

function formatPrice(price, productName) {
  if (!price) return "Check site";
  const p = Number(price).toFixed(2);
  const msrp = getReferenceMsrp(productName);
  if (!msrp) return `$${p}`;
  const diff = Number(price) - msrp;
  const m = msrp.toFixed(2);
  if (Math.abs(diff) < 0.50) return `$${p} ✅ at MSRP`;
  if (diff > msrp) return `$${p} 🚨 reseller price (MSRP ~$${m})`;
  if (diff > 0) return `$${p} ⚠️ above MSRP (~$${m})`;
  return `$${p} 🔥 $${Math.abs(diff).toFixed(2)} below MSRP (~$${m})`;
}

export async function sendRestockAlert({
  productName, retailer, retailerKey, storeName, storeAddress, storeId,
  url, price, imageUrl, msrp, discordConfig
}) {
  if (!discordConfig) {
    log.warn("Discord not configured — run /setup first");
    return;
  }

  if (isOnCooldown(productName, retailer, storeId)) {
    log.info(`Cooldown active — skipping ${productName} at ${storeName}`);
    return;
  }

  const channelId = isHotProduct(productName) && discordConfig.channels.hot
    ? discordConfig.channels.hot
    : discordConfig.channels.all;

  if (!channelId) {
    log.warn("No alert channel found — run /setup");
    return;
  }

  // Find which members have a relevant category role AND want this retailer
  const categories = getProductCategories(productName);
  const relevantRoleIds = new Set(
    categories.map(cat => discordConfig.roles[cat]).filter(Boolean)
  );

  const mentionStr = [...relevantRoleIds].map(id => `<@&${id}>`).join(" ");

  const isOnlineDrop = storeId === "online";
  const storeDisplay = isOnlineDrop
    ? `🌐 **Online Only** — [${storeName}](${url})`
    : (storeAddress ? `${storeName}\n${storeAddress}` : storeName);

  const onlineTitle = retailerKey === "pokemoncenter" ? "🛒 POKEMON CENTER DROP" : `🛒 ${retailer.toUpperCase()} ONLINE DROP`;
  const embed = {
    title: isOnlineDrop ? onlineTitle : "🚨 POKEMON RESTOCK ALERT",
    color: 0xffcb05,
    fields: [
      { name: "Product",  value: productName,              inline: false },
      { name: "Retailer", value: retailer,                 inline: true  },
      { name: "Store",    value: storeDisplay,             inline: true  },
      { name: "Price",    value: formatPrice(price, productName), inline: true  }
    ],
    timestamp: new Date().toISOString(),
    footer: { text: "Pokemon Restock Bot" }
  };

  if (imageUrl) embed.thumbnail = { url: imageUrl };

  const content = [
    mentionStr,
    `👀 **${productName}** is back in stock at **${retailer}**!`
  ].filter(Boolean).join(" ");

  try {
    await discord.sendMessage(channelId, {
      content,
      embeds: [embed],
      components: url ? [{
        type: 1,
        components: [{ type: 2, style: 5, label: "🛒 Buy Now", url }]
      }] : []
    });
    lastAlertAt[cooldownKey(productName, retailer, storeId)] = Date.now();
    log.info(`Alert sent: ${productName} at ${storeName}`);
  } catch (err) {
    log.error("Failed to send Discord alert:", err.message);
  }
}

// Called from discovery when a product is newly flagged or un-flagged as out of print
// Send a single batched message for all out-of-print flag changes in one discovery cycle.
export async function sendOutOfPrintBatch(discordConfig, flagChanges) {
  const channelId = discordConfig?.channels?.outOfPrint;
  if (!channelId || !flagChanges.length) return;

  const nowFlagged = flagChanges.filter(f => !f.wasOutOfPrint && f.product.outOfPrint);
  const nowReprinted = flagChanges.filter(f => f.wasOutOfPrint && !f.product.outOfPrint);

  const embeds = [];

  if (nowFlagged.length) {
    const lines = nowFlagged.map(({ product }) => {
      const msrp = getReferenceMsrp(product.name);
      return `• **${product.name}**${msrp ? ` — MSRP ~$${msrp.toFixed(2)}` : ""}`;
    });
    embeds.push({
      title: `📛 ${nowFlagged.length} Product(s) Flagged as Out of Print`,
      color: 0x95a5a6,
      description: lines.join("\n") + "\n\nAll retailers show reseller pricing (>2× MSRP). Restock alerts paused. Flag clears automatically if reprinted.",
      timestamp: new Date().toISOString()
    });
  }

  if (nowReprinted.length) {
    const lines = nowReprinted.map(({ product }) => {
      const msrp = getReferenceMsrp(product.name);
      return `• **${product.name}**${msrp ? ` — ~$${msrp.toFixed(2)} MSRP` : ""}`;
    });
    embeds.push({
      title: `✅ ${nowReprinted.length} Product(s) Back In Print!`,
      color: 0x2ecc71,
      description: lines.join("\n") + "\n\nShowing at retail pricing again. Restock alerts are now active.",
      timestamp: new Date().toISOString()
    });
  }

  try {
    await discord.sendMessage(channelId, { embeds });
  } catch (err) {
    log.warn("Failed to send out-of-print batch update:", err.message);
  }
}

export async function sendToLogs(discordConfig, message) {
  if (!discordConfig?.channels?.logs) return;
  try {
    await discord.sendMessage(discordConfig.channels.logs, { content: message });
  } catch {
    // logging failures are silent
  }
}
