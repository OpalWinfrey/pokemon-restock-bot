export function validateEnv() {
  const errors = [];
  const warnings = [];

  if (!process.env.USER_ZIP)          errors.push("USER_ZIP — your zip code so the bot can find nearby stores");
  if (!process.env.DISCORD_BOT_TOKEN) errors.push("DISCORD_BOT_TOKEN — from discord.com/developers/applications → Bot");
  if (!process.env.DISCORD_APP_ID)    errors.push("DISCORD_APP_ID — from discord.com/developers/applications → General");
  if (!process.env.DISCORD_PUBLIC_KEY) errors.push("DISCORD_PUBLIC_KEY — from discord.com/developers/applications → General");

  if (!process.env.DISCORD_GUILD_ID) {
    warnings.push("DISCORD_GUILD_ID not set — alerts won't be sent until this is set. Right-click your server name → Copy Server ID.");
  }
  console.log("\n📋 Startup check:");
  for (const w of warnings) console.warn(`  ⚠️  ${w}`);
  for (const e of errors)   console.error(`  ❌ Missing: ${e}`);
  if (!warnings.length && !errors.length) console.log("  ✅ All good\n");
  else console.log("");

  if (errors.length > 0) {
    console.error("Add the missing values to your .env file (copy .env.example to get started).\n");
    process.exit(1);
  }
}
