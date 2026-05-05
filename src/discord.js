import axios from "axios";

export async function sendRestockAlert({ productName, retailer, storeName, storeId, url, price }) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

  if (!webhookUrl) {
    console.error("❌ DISCORD_WEBHOOK_URL not set in .env");
    return;
  }

  const embed = {
    title: "🚨 POKEMON RESTOCK ALERT",
    color: 0xffcb05,
    fields: [
      { name: "Product", value: productName, inline: false },
      { name: "Retailer", value: retailer, inline: true },
      { name: "Store", value: storeName ?? `#${storeId}`, inline: true },
      { name: "Price", value: price ? `$${price}` : "Check site", inline: true },
      { name: "Link", value: url, inline: false }
    ],
    timestamp: new Date().toISOString(),
    footer: { text: "Pokemon Restock Bot" }
  };

  try {
    await axios.post(webhookUrl, {
      content: "@everyone 👀 Something is back in stock!",
      embeds: [embed]
    });
    console.log(`✅ Discord alert sent: ${productName} at ${retailer} — ${storeName}`);
  } catch (err) {
    console.error("❌ Failed to send Discord alert:", err.message);
  }
}
