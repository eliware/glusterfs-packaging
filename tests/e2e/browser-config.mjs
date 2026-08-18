import { existsSync } from "node:fs";

export function browserArgs() {
  return process.getuid?.() === 0
    ? ["--no-sandbox", "--disable-dev-shm-usage"]
    : ["--disable-dev-shm-usage"];
}

export async function chromePath(puppeteer) {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const systemChrome = [
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
  ].find((candidate) => process.platform === "linux" && existsSync(candidate));
  return systemChrome ?? (await puppeteer.executablePath());
}

export const targetPages = [
  { name: "homepage", path: "/" },
  { name: "directory-index", path: "/el10/x86_64/" },
  { name: "directory-11-2", path: "/el10/x86_64/11.2/" },
  { name: "blog-index", path: "/blog", kind: "blog" },
  {
    name: "blog-article",
    path: "/blog/welcome-to-the-eliware-glusterfs-blog",
    kind: "blog",
  },
];
