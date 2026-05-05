/**
 * Validates required env vars on startup.
 * Prints a clear checklist and exits if anything critical is missing.
 */

export function validateEnv() {
  const errors = [];
  const warnings = [];

  // Hard requirements
  if (!process.env.DISCORD_WEBHOOK_URL) {
    errors.push("DISCORD_WEBHOOK_URL is missing — alerts have nowhere to go");
  }
  if (!process.env.USER_ZIP) {
    errors.push("USER_ZIP is missing — the bot cannot find nearby stores");
  }

  // Soft warnings (bot works but features are degraded)
  if (!process.env.BESTBUY_API_KEY) {
    warnings.push("BESTBUY_API_KEY not set — Best Buy will be skipped (get a free key at developer.bestbuy.com)");
  }
  if (!process.env.DISCORD_APP_ID || !process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_PUBLIC_KEY) {
    warnings.push("DISCORD_APP_ID / DISCORD_BOT_TOKEN / DISCORD_PUBLIC_KEY not fully set — slash commands (/status, /subscribe, etc.) will not work");
  }
  if (!process.env.DISCORD_ALERT_ROLE_ID) {
    warnings.push("DISCORD_ALERT_ROLE_ID not set — will ping @everyone instead of a specific role");
  }
  if (!process.env.DISCORD_HOT_WEBHOOK_URL) {
    warnings.push("DISCORD_HOT_WEBHOOK_URL not set — ETBs and boxes will post to the same channel as everything else");
  }

  // Print results
  console.log("\n📋 Startup validation:");
  if (warnings.length === 0 && errors.length === 0) {
    console.log("  ✅ All checks passed\n");
    return;
  }

  for (const w of warnings) {
    console.warn(`  ⚠️  ${w}`);
  }
  for (const e of errors) {
    console.error(`  ❌ ${e}`);
  }

  console.log("");

  if (errors.length > 0) {
    console.error("Fix the above errors in your .env file before starting the bot.");
    console.error("Copy .env.example to .env and fill in the values.\n");
    process.exit(1);
  }
}
