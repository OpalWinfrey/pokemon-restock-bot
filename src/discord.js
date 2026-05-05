import axios from "axios";
import { classifyProduct } from "./classify.js";
import { getMentionsForProduct } from "./users.js";
import { log } from "./logger.js";

const lastAlertAt = {};

function cooldownKey(productName, retailer, storeId) {
  return `${productName}__${retailer}__${storeId}`;
}

function isOnCooldown(productName, retailer, storeId) {
  const cooldownMs = parseInt(process.env.ALERT_COOLDOWN_MINUTES ?? "60") * 60 * 1000;
  const key = cooldownKey(productName, retailer, storeId);
  const last = lastAlertAt[key];
  return last && Date.now() - last < cooldownMs;
}

function markAlerted(productName, retailer, storeId) {
  lastAlertAt[cooldownKey(productName, retailer, storeId)] = Date.now();
}

function getWebhookUrl(productName) {
  const tier = classifyProduct(productName);
  if (tier === "hot" && process.env.DISCORD_HOT_WEBHOOK_URL) return process.env.DISCORD_HOT_WEBHOOK_URL;
  return process.env.DISCORD_WEBHOOK_URL;
}

function buildMention(productName) {
  const subscribers = getMentionsForProduct(productName);
  if (subscribers.length > 0) return subscribers.join(" ");
  const roleId = process.env.DISCORD_ALERT_ROLE_ID;
  return roleId ? `<@&${roleId}>` : "@everyone";
}

function formatPrice(price, msrp) {
  if (!price) return "Check site";

  const priceStr = `$${Number(price).toFixed(2)}`;
  if (!msrp) return priceStr;

  const diff = Number(price) - Number(msrp);
  const msrpStr = `$${Number(msrp).toFixed(2)}`;

  if (Math.abs(diff) < 0.50) return `${priceStr} (MSRP ✅)`;
  if (diff > 0) return `${priceStr} ⚠️ +$${diff.toFixed(2)} over MSRP (${msrpStr})`;
  return `${priceStr} 🔥 $${Math.abs(diff).toFixed(2)} below MSRP (${msrpStr})`;
}

export async function sendRestockAlert({ productName, retailer, storeName, storeAddress, storeId, url, price, imageUrl, msrp }) {
  if (isOnCooldown(productName, retailer, storeId)) {
    log.info(`⏳ Cooldown active — skipping alert for ${productName} at ${storeName}`);
    return;
  }

  const webhookUrl = getWebhookUrl(productName);
  if (!webhookUrl) {
    log.error("DISCORD_WEBHOOK_URL not set — cannot send alert");
    return;
  }

  const storeDisplay = storeAddress ? `${storeName}\n${storeAddress}` : storeName;

  const embed = {
    title: "🚨 POKEMON RESTOCK ALERT",
    color: 0xffcb05,
    fields: [
      { name: "Product",  value: productName,               inline: false },
      { name: "Retailer", value: retailer,                   inline: true  },
      { name: "Store",    value: storeDisplay,               inline: true  },
      { name: "Price",    value: formatPrice(price, msrp),   inline: true  },
      { name: "🛒 Buy Now", value: `[Click here to buy](${url})`, inline: false }
    ],
    timestamp: new Date().toISOString(),
    footer: { text: "Pokemon Restock Bot" }
  };

  if (imageUrl) embed.thumbnail = { url: imageUrl };

  try {
    await axios.post(webhookUrl, {
      content: `${buildMention(productName)} 👀 **${productName}** is back in stock!`,
      embeds: [embed]
    });
    markAlerted(productName, retailer, storeId);
    log.info(`Discord alert sent: ${productName} at ${storeName}`);
  } catch (err) {
    log.error("Failed to send Discord alert:", err.message, err.response?.data);
  }
}
