#!/usr/bin/env node
import path from "node:path";
import { tmpdir } from "node:os";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { env, repoRoot } from "./lib.mjs";

const configuredContext = env("HTTP_IMAGE_CONTEXT");
const context = configuredContext
  ? path.resolve(configuredContext)
  : await mkdtemp(path.join(tmpdir(), "gluster-http-context."));
const packageJson = JSON.parse(
  await readFile(path.join(repoRoot, "package.json"), "utf8"),
);
const currentYear = new Date().getUTCFullYear();
const copyrightYear = currentYear <= 2026 ? "2026" : `2026-${currentYear}`;
const assetVersion = new Date().toISOString().replace(/[-:.TZ]/g, "");

await rm(context, { recursive: true, force: true });
await mkdir(path.join(context, "site/assets"), { recursive: true });
await mkdir(path.join(context, "web/src/be"), { recursive: true });
await cp(
  path.join(repoRoot, "package.json"),
  path.join(context, "package.json"),
);

for (const file of [
  "index.html",
  "browse.html",
  "about.html",
  "tos.html",
  "policy.html",
  "blog.html",
]) {
  const template = await readFile(
    path.join(repoRoot, "templates", file),
    "utf8",
  );
  await writeFile(
    path.join(context, "site", file),
    template
      .replaceAll("__COPYRIGHT_YEAR__", copyrightYear)
      .replaceAll("__APP_VERSION__", packageJson.version)
      .replaceAll("__ASSET_VERSION__", assetVersion),
  );
}

await cp(
  path.join(repoRoot, "templates/directory-listing.html"),
  path.join(context, "site/directory-listing.html"),
);
await writeFile(
  path.join(context, "site/robots.txt"),
  "User-agent: *\nAllow: /\n\nSitemap: https://glusterfs.eliware.org/sitemap.xml\n",
);
await writeFile(
  path.join(context, "site/sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[
    "/",
    "/el10/",
    "/el10/x86_64/",
    "/about",
    "/blog",
    "/feed.xml",
    "/policy",
    "/tos",
  ]
    .map((url) => `  <url><loc>https://glusterfs.eliware.org${url}</loc></url>`)
    .join("\n")}\n</urlset>\n`,
);

for (const file of [
  "favicon.ico",
  "eliware-brand.svg",
  "gluster-logo.webp",
  "gluster-logo-thumb.webp",
])
  await cp(
    path.join(repoRoot, "assets", file),
    path.join(context, "site/assets", file),
  );

await cp(path.join(repoRoot, "src/be"), path.join(context, "web/src/be"), {
  recursive: true,
});
process.env.WEB_ASSET_OUTPUT = path.join(context, "site/web");
process.env.HTTP_SERVER_ROOT = path.join(repoRoot, "src");
await import("./build-web-assets.mjs");
console.log(context);
