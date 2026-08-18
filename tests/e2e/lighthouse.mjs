import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { launch } from "chrome-launcher";
import lighthouse, { generateReport } from "lighthouse";
import puppeteer from "puppeteer";
import { browserArgs, chromePath, targetPages } from "./browser-config.mjs";

const baseUrl = (
  process.env.E2E_BASE_URL ?? "https://glusterfs.eliware.org"
).replace(/\/$/, "");
const outputDir = resolve(
  process.env.LIGHTHOUSE_OUTPUT_DIR ?? "artifacts/lighthouse",
);
const chrome = await launch({
  chromePath: await chromePath(puppeteer),
  chromeFlags: ["--headless", ...browserArgs()],
});

try {
  await mkdir(outputDir, { recursive: true });
  for (const target of targetPages) {
    const result = await lighthouse(`${baseUrl}${target.path}`, {
      port: chrome.port,
      logLevel: "error",
      onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
      formFactor: "desktop",
      screenEmulation: {
        mobile: false,
        width: 1440,
        height: 1000,
        deviceScaleFactor: 1,
      },
    });
    if (!result?.lhr)
      throw new Error(`Lighthouse did not return a result for ${target.name}`);
    await writeFile(
      join(outputDir, `${target.name}.html`),
      generateReport(result.lhr, "html"),
    );
    await writeFile(
      join(outputDir, `${target.name}.json`),
      `${JSON.stringify(result.lhr, null, 2)}\n`,
    );
    const scores = Object.fromEntries(
      Object.entries(result.lhr.categories).map(([category, value]) => [
        category,
        value.score == null ? null : Math.round(value.score * 100),
      ]),
    );
    console.log(`${target.name}: ${JSON.stringify(scores)}`);
  }
  console.log(`Lighthouse reports written to ${outputDir}`);
} finally {
  chrome.kill();
}
