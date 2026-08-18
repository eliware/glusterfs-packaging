#!/usr/bin/env node
import path from "node:path";
import { mkdir, readdir, rm } from "node:fs/promises";
import { env, exists, repoRoot, runInteractive } from "./lib.mjs";

const webRoot = env("WEB_ASSET_OUTPUT", path.join(repoRoot, "artifacts/web"));
const sourceRoot = env("HTTP_SERVER_ROOT", path.join(repoRoot, "src"));

if (!(await exists(path.join(sourceRoot, "webpack.config.mjs"))))
  throw new Error(`missing webpack config: ${sourceRoot}`);
await mkdir(webRoot, { recursive: true });

const buildEnv = { ...process.env, WEB_ASSET_OUTPUT: webRoot };
await runInteractive("npm", ["--prefix", repoRoot, "run", "build:web"], {
  env: { ...buildEnv, WEB_ASSET_VARIANT: "readable" },
});
await runInteractive("npm", ["--prefix", repoRoot, "run", "build:web"], {
  env: { ...buildEnv, WEB_ASSET_VARIANT: "pretty" },
});
await runInteractive("npm", ["--prefix", repoRoot, "run", "build:web"], {
  env: { ...buildEnv, WEB_ASSET_VARIANT: "production" },
});

for (const file of await readdir(webRoot)) {
  if (file.endsWith(".LICENSE.txt")) await rm(path.join(webRoot, file));
}

console.log((await readdir(webRoot)).sort().join("\n"));
