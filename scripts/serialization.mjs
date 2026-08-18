import { readFile, writeFile } from "node:fs/promises";

export function isoTimestamp(value = new Date()) {
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function compactTimestamp(value = new Date()) {
  return new Date(value).toISOString().replace(/[-:.TZ]/g, "");
}

export function dateStamp(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10).replaceAll("-", ".");
}

export function parseJson(text, label = "JSON document") {
  try {
    return JSON.parse(text);
  } catch (error) {
    error.message = `${label}: ${error.message}`;
    throw error;
  }
}

export function stringifyJson(value, { pretty = true } = {}) {
  return `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`;
}

export async function readJson(file, label = file) {
  return parseJson(await readFile(file, "utf8"), label);
}

export async function writeJson(file, value, options) {
  await writeFile(file, stringifyJson(value, options));
}
