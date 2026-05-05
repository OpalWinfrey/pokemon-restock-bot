import { discord } from "./discord-api.js";
import { getProductCategories, isHotProduct } from "./classify.js";
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

function formatPrice(price, msrp) {
  if (!price) return "Check site";
  const p = Number(price).toFixed(2);
  if (!msrp) return `$${p}`;
  const diff = Number(price) - Number(msrp);
  const m = Number(msrp).toFixed(2);
  if (Math.abs(diff) < 0.50) return `$${p} ✅ MSRP`;
  if (diff > 0) return `$${p} ⚠️ +$${diff.toFixed(2)} over MSRP ($${m})`;
  return `$${p} 🔥 $${Math.abs(diff).toFixed(2)} below MSRP ($${m})`;
}

export async function sendRestockAlert({ productName, retailer, storeName, storeAddress, storeId, url, price, imageUrl, msrp, discordConfig }) {
  if (!discordConfig) {
    log.warn("Discord not configured — run /setup first");
    return;
  }

  if (isOnCooldown(productName, retailer, storeId)) {
    log.info(`Cooldown active — skipping ${productName} at ${storeName}`);
    return;
  }

  // Pick the right channel
  const channelId = isHotProduct(productName) && discordConfig.channels.hot
    ? discordConfig.channels.hot
    : discordConfig.channels.all;

  if (!channelId) {
    log.warn("No alert channel found — run /setup");
    return;
  }

  // Build role mentions from every category this product matches
  const categories = getProductCategories(productName);
  const mentions = [...new Set(
    categories.map(cat => discordConfig.roles[cat]).filter(Boolean).map(id => `<@&${id}>`)
  )];
  const mention = mentions.length > 0 ? mentions.join(" ") : "@everyone";

  const storeDisplay = storeAddress ? `${storeName}\n${storeAddress}` : storeName;

  const embed = {
    title: "🚨 POKEMON RESTOCK ALERT",
    color: 0xffcb05,
    fields: [
      { name: "Product",    value: productName,              inline: false },
      { name: "Retailer",   value: retailer,                 inline: true  },
      { name: "Store",      value: storeDisplay,             inline: true  },
      { name: "Price",      value: formatPrice(price, msrp), inline: true  },
      { name: "🛒 Buy Now", value: `[Click here](${url})`,   inline: false }
    ],
    timestamp: new Date().toISOString(),
    footer: { text: "Pokemon Restock Bot" }
  };

  if (imageUrl) embed.thumbnail = { url: imageUrl };

  try {
    await discord.sendMessage(channelId, {
      content: `${mention} 👀 **${productName}** is back in stock!`,
      embeds: [embed]
    });
    lastAlertAt[cooldownKey(productName, retailer, storeId)] = Date.now();
    log.info(`Alert sent: ${productName} at ${storeName}`);
  } catch (err) {
    log.error("Failed to send Discord alert:", err.message);
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
