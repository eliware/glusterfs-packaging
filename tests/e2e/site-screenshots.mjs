import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import puppeteer, { KnownDevices } from "puppeteer";
import { browserArgs, chromePath, targetPages } from "./browser-config.mjs";

const baseUrl = (
  process.env.E2E_BASE_URL ?? "https://glusterfs.eliware.org"
).replace(/\/$/, "");
const outputDir = resolve(
  process.env.SCREENSHOT_OUTPUT_DIR ?? "artifacts/e2e-screenshots",
);
const iphone12 = KnownDevices["iPhone 12"];
const viewports = [
  {
    name: "desktop-1080p",
    viewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
  },
  {
    name: "desktop-1440p",
    viewport: { width: 2560, height: 1440, deviceScaleFactor: 1 },
  },
  {
    name: "desktop-2160p",
    viewport: { width: 3840, height: 2160, deviceScaleFactor: 1 },
  },
  { name: "iphone-12-portrait", viewport: iphone12.viewport },
  {
    name: "iphone-12-landscape",
    viewport: {
      ...iphone12.viewport,
      width: iphone12.viewport.height,
      height: iphone12.viewport.width,
      isLandscape: true,
    },
  },
];
const browser = await puppeteer.launch({
  executablePath: await chromePath(puppeteer),
  headless: true,
  args: browserArgs(),
});

async function waitForPublishedContent(page, target) {
  await page.waitForFunction(
    ({ name, kind }) => {
      if (kind === "blog") {
        const status = document.querySelector("#blog-status")?.textContent;
        const article = document.querySelector("#blog-article");
        const posts = document.querySelectorAll("#blog-list .blog-card");
        const articleReady = article && !article.classList.contains("d-none");
        const listingReady =
          posts.length > 0 && status && !status.includes("Loading");
        return Boolean(articleReady || listingReady);
      }
      if (name === "homepage") {
        const packageStatus = document.querySelector(
          "#package-search-status",
        )?.textContent;
        const timeline = document.querySelector("#release-timeline");
        return (
          packageStatus &&
          !packageStatus.includes("Loading") &&
          timeline?.querySelector("li") &&
          !timeline.textContent.includes("Loading")
        );
      }
      const entries = document.querySelector(
        "#directory-entries, .directory-card table tbody, table tbody",
      );
      const title = document.querySelector("#directory-title")?.textContent;
      return Boolean(title && entries?.querySelector("tr"));
    },
    { timeout: 15_000 },
    target,
  );
}

try {
  await mkdir(outputDir, { recursive: true });
  const page = await browser.newPage();
  for (const viewport of viewports) {
    await page.setViewport(viewport.viewport);
    for (const target of targetPages) {
      const url = `${baseUrl}${target.path}`;
      await page.goto(url, { waitUntil: "networkidle2", timeout: 60_000 });
      await waitForPublishedContent(page, target);
      const fileStem = `${target.name}-${viewport.name}`;
      await page.screenshot({
        path: resolve(outputDir, `${fileStem}-above-fold.png`),
        fullPage: false,
      });
      await page.screenshot({
        path: resolve(outputDir, `${fileStem}-full-page.png`),
        fullPage: true,
      });
      console.log(`Screenshots written for ${url} at ${viewport.name}`);
    }
  }
} finally {
  await browser.close();
}
