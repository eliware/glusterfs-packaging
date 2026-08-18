import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@jest/globals";
import { repositoryDirectory } from "../../src/be/repository-directory.mjs";

test("lists the repository root without treating it as index.html", async () => {
  const publicDir = await mkdtemp(path.join(os.tmpdir(), "repository-root-"));
  await mkdir(path.join(publicDir, "el10"));
  await writeFile(
    path.join(publicDir, "glusterfs-el10.repo"),
    "[glusterfs-stable]\n",
  );

  const listing = await repositoryDirectory(
    { publicDir, allowDotfiles: false },
    "/",
  );

  expect(listing.path).toBe("/");
  expect(listing.entries.map((entry) => entry.name)).toEqual([
    "el10",
    "glusterfs-el10.repo",
  ]);
  expect(listing.entries[0].href).toBe("/el10/");
});
