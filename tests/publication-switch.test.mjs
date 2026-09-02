import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { switchPublicationTarget } from "../scripts/publication-switch.mjs";

const publicationSwitchTest =
  process.platform === "win32" ? test.skip : test;

publicationSwitchTest("publication target switches atomically between generations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "publication-switch-"));
  try {
    const generations = path.join(root, "generations");
    const target = path.join(root, "stable");
    const first = path.join(generations, "first");
    const second = path.join(generations, "second");
    await mkdir(first, { recursive: true });
    await mkdir(second, { recursive: true });
    await writeFile(path.join(first, "marker"), "first\n");
    await writeFile(path.join(second, "marker"), "second\n");

    await switchPublicationTarget(target, first, "one");
    expect(await readFile(path.join(target, "marker"), "utf8")).toBe("first\n");
    await switchPublicationTarget(target, second, "two");
    expect(await readFile(path.join(target, "marker"), "utf8")).toBe("second\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
