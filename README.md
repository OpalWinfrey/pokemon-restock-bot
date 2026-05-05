# 🎴 Pokemon Restock Bot

A Discord notification bot that monitors Target, Walmart, Best Buy, and Costco for local Pokemon card restocks and pings your server the moment something comes back in stock.

---

## How It Works

1. Every 60 seconds (configurable), the bot polls each retailer's inventory API for your local store
2. When a product goes from out-of-stock → in-stock, it fires a Discord webhook alert
3. It won't spam — it only alerts once per restock event

---

## Setup

### 1. Clone the repo
```bash
git clone https://github.com/OpalWinfrey/pokemon-restock-bot.git
cd pokemon-restock-bot
npm install
```

### 2. Create your `.env` file
```bash
cp .env.example .env
```
Then fill in the values:

```env
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
TARGET_STORE_ID=1234
WALMART_STORE_ID=5678
BESTBUY_STORE_ID=9999
BESTBUY_API_KEY=your_bestbuy_api_key_here
COSTCO_WAREHOUSE_ID=1234
POLL_INTERVAL_SECONDS=60
```

### 3. Find your store IDs

**Target Store ID:**
- Go to target.com and search for a product
- Add it to cart, select "Pick up"
- Your local store ID will appear in the URL or network requests
- Or visit: `https://www.target.com/store-locator/find-stores` and inspect the network tab

**Walmart Store ID:**
- Go to walmart.com and set your local store
- The store ID appears in the URL: `walmart.com/store/STORE_ID/...`

**Best Buy Store ID:**
- Go to bestbuy.com and set your local store
- The store ID appears in the URL: `bestbuy.com/site/store/STORE_ID/...`
- You also need a free API key from [developer.bestbuy.com](https://developer.bestbuy.com)

**Costco Warehouse ID:**
- Go to costco.com and find your local warehouse
- The warehouse ID appears in the URL: `costco.com/warehouse-locations/warehouse.STORE_ID.html`

### 4. Set up Discord Webhook
- Open your Discord server
- Go to a channel → Edit Channel → Integrations → Webhooks
- Create a new webhook and copy the URL
- Paste it into your `.env` as `DISCORD_WEBHOOK_URL`

### 5. Configure products to track
Edit `config/products.js` and add the products you want to monitor.

**Finding product IDs:**
- **Target TCIN:** in the URL — `target.com/p/product-name/-/A-XXXXXXXX`
- **Walmart Item ID:** in the URL — `walmart.com/ip/product-name/XXXXXXXXXX`
- **Best Buy SKU:** in the URL — `bestbuy.com/site/name/XXXXXXXXX.p?skuId=XXXXXXXXX`
- **Costco Item Number:** 7-digit number in the URL — `costco.com/product-name.product.XXXXXXX.html`

### 6. Run locally
```bash
npm run dev
```

---

## Deploying to Railway (free, runs 24/7)

1. Push your code to GitHub (make sure `.env` is in `.gitignore` ✅)
2. Go to [railway.app](https://railway.app) and create a new project
3. Connect your GitHub repo
4. Add your environment variables in Railway's dashboard (same as your `.env`)
5. Deploy — Railway will keep it running automatically

---

## Project Structure

```
pokemon-restock-bot/
├── config/
│   └── products.js         ← Add products to track here
├── src/
│   ├── checkers/
│   │   ├── target.js       ← Target inventory checker
│   │   ├── walmart.js      ← Walmart inventory checker
│   │   ├── bestbuy.js      ← Best Buy inventory checker
│   │   └── costco.js       ← Costco inventory checker
│   ├── discord.js          ← Discord webhook sender
│   └── index.js            ← Main entry point + polling loop
├── .env.example            ← Copy to .env and fill in values
├── railway.toml            ← Railway deployment config
└── package.json
```

---

## Adding More Retailers

Create a new file in `src/checkers/` following the same pattern as the existing checkers, then import and call it in `src/index.js`.

---

## Troubleshooting

| Issue | Fix |
|---|---|
| No alerts firing | Check your `.env` values are correct |
| Discord webhook 404 | Regenerate the webhook URL in Discord |
| Always showing out of stock | Double-check your product ID and store ID |
| Rate limited | Increase `POLL_INTERVAL_SECONDS` to 120+ |
| Best Buy always failing | Make sure `BESTBUY_API_KEY` is set in `.env` |
| Costco always failing | The Costco endpoint is unofficial and may need updating |
