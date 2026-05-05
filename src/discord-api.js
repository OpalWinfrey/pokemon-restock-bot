/**
 * Thin wrapper around the Discord REST API.
 * Uses the bot token — no webhooks needed anywhere.
 */

import axios from "axios";
import { log } from "./logger.js";

const BASE = "https://discord.com/api/v10";

function auth() {
  return { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" };
}

async function call(method, path, data) {
  try {
    const { data: res } = await axios({ method, url: `${BASE}${path}`, data, headers: auth(), timeout: 10000 });
    return res;
  } catch (err) {
    log.error(`Discord API ${method.toUpperCase()} ${path} failed:`, err.response?.data ?? err.message);
    throw err;
  }
}

export const discord = {
  getChannels:      guildId        => call("get",    `/guilds/${guildId}/channels`),
  getRoles:         guildId        => call("get",    `/guilds/${guildId}/roles`),
  createChannel:   (guildId, body) => call("post",   `/guilds/${guildId}/channels`, body),
  createRole:      (guildId, body) => call("post",   `/guilds/${guildId}/roles`, body),
  sendMessage:     (channelId, body) => call("post", `/channels/${channelId}/messages`, body),
  getMember:       (guildId, userId) => call("get",  `/guilds/${guildId}/members/${userId}`),
  addRole:    (guildId, userId, roleId) => call("put",    `/guilds/${guildId}/members/${userId}/roles/${roleId}`, {}),
  removeRole: (guildId, userId, roleId) => call("delete", `/guilds/${guildId}/members/${userId}/roles/${roleId}`)
};
