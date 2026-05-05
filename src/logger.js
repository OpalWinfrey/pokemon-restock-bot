/**
 * Structured logger with timestamps, log levels, and optional Discord error reporting.
 *
 * Set LOG_LEVEL=debug in .env to see full API responses and request details.
 * Set DISCORD_LOG_WEBHOOK_URL to receive errors and warnings in a private Discord channel.
 */

import axios from "axios";

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const current = LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LEVELS.info;

function ts() {
  return new Date().toISOString();
}

function format(level, args) {
  return `[${ts()}] [${level.toUpperCase()}] ${args.map(a =>
    typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)
  ).join(" ")}`;
}

async function postToDiscord(level, message) {
  const url = process.env.DISCORD_LOG_WEBHOOK_URL;
  if (!url) return;

  const colors = { warn: 0xffa500, error: 0xff0000 };
  try {
    await axios.post(url, {
      embeds: [{
        title: level === "error" ? "🔴 Bot Error" : "🟡 Bot Warning",
        description: `\`\`\`\n${message.slice(0, 1900)}\n\`\`\``,
        color: colors[level] ?? 0xcccccc,
        timestamp: new Date().toISOString(),
        footer: { text: "Pokemon Restock Bot — Debug Log" }
      }]
    }, { timeout: 5000 });
  } catch {
    // Don't let logging failures crash anything
  }
}

export const log = {
  debug: (...args) => {
    if (current <= LEVELS.debug) console.log(format("debug", args));
  },
  info: (...args) => {
    if (current <= LEVELS.info) console.log(format("info", args));
  },
  warn: (...args) => {
    if (current <= LEVELS.warn) {
      const msg = format("warn", args);
      console.warn(msg);
      postToDiscord("warn", msg);
    }
  },
  error: (...args) => {
    if (current <= LEVELS.error) {
      const msg = format("error", args);
      console.error(msg);
      postToDiscord("error", msg);
    }
  }
};
