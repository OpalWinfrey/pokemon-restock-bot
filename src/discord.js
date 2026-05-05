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

  let mentionStr = "";
  try {
    const allMembers = await discord.getMembers(discordConfig.guildId);
    const toNotify = allMembers.filter(m =>
      !m.user?.bot &&
      m.roles.some(r => relevantRoleIds.has(r)) &&
      userWantsRetailer(m.user.id, retailerKey)
    );
    mentionStr = toNotify.map(m => `<@${m.user.id}>`).join(" ");
  } catch (err) {
    log.warn("Could not fetch members for mentions:", err.message);
  }

  const isOnlineDrop = storeId === "online";
  const storeDisplay = isOnlineDrop
    ? `🌐 **Online Only** — [pokemoncenter.com](${url})`
    : (storeAddress ? `${storeName}\n${storeAddress}` : storeName);

  const embed = {
    title: isOnlineDrop ? "🛒 POKEMON CENTER ONLINE DROP" : "🚨 POKEMON RESTOCK ALERT",
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
export async function sendOutOfPrintUpdate(discordConfig, product, wasOutOfPrint) {
  const channelId = discordConfig?.channels?.outOfPrint;
  if (!channelId) return;
  const msrp = getReferenceMsrp(product.name);
  try {
    if (!wasOutOfPrint && product.outOfPrint) {
      // Newly flagged
      await discord.sendMessage(channelId, {
        embeds: [{
          title: "📛 Flagged as Out of Print",
          color: 0x95a5a6,
          description: `**${product.name}**\nAll retailers show prices ${msrp ? `above $${(msrp * 2).toFixed(2)} (2× MSRP of $${msrp.toFixed(2)})` : "far above expected retail"}. No restock alerts will fire for reseller-priced stock.\nIf a reprint is announced, this flag will clear automatically.`,
          timestamp: new Date().toISOString()
        }]
      });
    } else if (wasOutOfPrint && !product.outOfPrint) {
      // Reprinted — back in stock at retail price or found on Pokemon Center
      await discord.sendMessage(channelId, {
        embeds: [{
          title: "✅ Back In Print!",
          color: 0x2ecc71,
          description: `**${product.name}**\nThis product is showing at retail pricing again${msrp ? ` (~$${msrp.toFixed(2)} MSRP)` : ""}. Restock alerts are now active.`,
          timestamp: new Date().toISOString()
        }]
      });
    }
  } catch (err) {
    log.warn("Failed to send out-of-print update:", err.message);
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
