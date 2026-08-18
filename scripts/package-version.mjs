import { readFileSync } from "node:fs";
import path from "node:path";

const packageFile = path.resolve(import.meta.dirname, "../package.json");
const packageJson = JSON.parse(readFileSync(packageFile, "utf8"));

if (typeof packageJson.version !== "string" || !packageJson.version.trim())
  throw new Error(`package.json is missing a valid version: ${packageFile}`);

export const PACKAGE_VERSION = packageJson.version;
