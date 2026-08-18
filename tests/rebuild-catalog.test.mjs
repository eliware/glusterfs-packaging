import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { rebuildCatalog } from "../scripts/rebuild-catalog.mjs";
import { METADATA_VERSION } from "../scripts/metadata-version.mjs";

const record = (overrides = {}) => ({
  metadata_version: METADATA_VERSION,
  channel: "stable",
  distribution: "debian",
  version: "11.2",
  built: "2026-08-18T04:00:00Z",
  candidate: "debian-stable-11.2",
  package: {
    format: "deb",
    distribution: "debian",
    version: "11.2-1",
  },
  ...overrides,
});

test("rebuilds package and image indexes from publication records", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gluster-catalog-"));
  const records = path.join(root, "metadata/records/stable/debian");
  const output = path.join(root, "metadata/catalog.json");
  await mkdir(records, { recursive: true });
  await writeFile(
    path.join(records, "package.json"),
    JSON.stringify(record()) + "\n",
  );
  await writeFile(
    path.join(records, "image.json"),
    JSON.stringify(
      record({
        image: {
          repository: "ghcr.io/eliware/debian12-gluster",
          digest: "sha256:image",
        },
      }),
    ) + "\n",
  );

  try {
    const catalog = await rebuildCatalog({ root, output });
    expect(catalog.stable.package.format).toBe("deb");
    expect(catalog.images).toHaveLength(1);
    expect(catalog.images[0].image.digest).toBe("sha256:image");
    expect(JSON.parse(await readFile(output, "utf8"))).toMatchObject({
      metadata_version: METADATA_VERSION,
      packages: [{ candidate: "debian-stable-11.2" }],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
