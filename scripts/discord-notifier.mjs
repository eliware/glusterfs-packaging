import { sendMessage } from "@eliware/discord-webhook";
import { env } from "./lib.mjs";

const webhookUrl = env("CONDUCTOR_DISCORD_WEBHOOK", env("DISCORD_WEBHOOK", ""));
const colors = { success: 0x2ecc71, failure: 0xe74c3c, info: 0x3498db };
const avatarUrl = "https://glusterfs.eliware.org/assets/eliware-brand.svg";
const thumbnailUrl =
  "https://glusterfs.eliware.org/assets/gluster-logo-thumb.webp";
const FIELD_VALUE_LIMIT = 1024;
const FIELD_NAME_LIMIT = 256;
const EMBED_SAFETY_LIMIT = 5900;

export function truncateDiscord(value, limit) {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1))}…`;
}

function splitField({ name, value, inline = true }) {
  const safeName = truncateDiscord(name, FIELD_NAME_LIMIT);
  const lines = String(value ?? "").split("\n");
  const chunks = [];
  let current = "";
  for (const line of lines) {
    const safeLine = truncateDiscord(line, FIELD_VALUE_LIMIT);
    const candidate = current ? `${current}\n${safeLine}` : safeLine;
    if (candidate.length > FIELD_VALUE_LIMIT && current) {
      chunks.push(current);
      current = safeLine;
    } else {
      current = candidate;
    }
  }
  if (current || !chunks.length) chunks.push(current);
  return chunks.map((chunk, index) => ({
    name:
      chunks.length > 1
        ? truncateDiscord(
            `${safeName} (${index + 1}/${chunks.length})`,
            FIELD_NAME_LIMIT,
          )
        : safeName,
    value: chunk,
    inline,
  }));
}

export function limitDiscordFields(fields, baseCharacterCount = 0) {
  const expanded = fields.flatMap(splitField);
  const output = [];
  let used = baseCharacterCount;
  for (const field of expanded.slice(0, 25)) {
    const remaining = EMBED_SAFETY_LIMIT - used - field.name.length;
    if (remaining <= 1) break;
    const value = truncateDiscord(
      field.value,
      Math.min(FIELD_VALUE_LIMIT, remaining),
    );
    output.push({ ...field, value });
    used += field.name.length + value.length;
  }
  return output;
}

export async function notifyConductor({
  title,
  description,
  status = "info",
  fields = [],
  report = null,
}) {
  if (!webhookUrl) return false;
  try {
    const embedTitle = truncateDiscord(title, 256);
    const embedDescription = truncateDiscord(description, 4096);
    const authorName = "Eliware GlusterFS Release Conductor";
    const footerText = "Certified release report · glusterfs.eliware.org";
    const embedFields = limitDiscordFields(
      [...fields, ...(report?.fields || [])],
      embedTitle.length +
        embedDescription.length +
        authorName.length +
        footerText.length,
    );
    const response = await sendMessage({
      url: webhookUrl,
      timeoutMs: 10_000,
      body: {
        username: "GlusterFS Conductor",
        avatar_url: avatarUrl,
        embeds: [
          {
            title: embedTitle,
            description: embedDescription,
            color: colors[status] || colors.info,
            fields: embedFields,
            ...(report?.cardUrl
              ? {
                  image: { url: report.cardUrl },
                  thumbnail: { url: thumbnailUrl },
                }
              : {}),
            author: { name: authorName },
            footer: { text: footerText },
            timestamp: new Date().toISOString(),
          },
        ],
      },
    });
    if (!response.ok)
      throw new Error(`Discord webhook returned HTTP ${response.status}`);
    return true;
  } catch (error) {
    console.warn(`[conductor] webhook notification failed: ${error.message}`);
    return false;
  }
}
