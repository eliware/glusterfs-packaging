import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { rebuildCatalog } from "../scripts/rebuild-catalog.mjs";
import { METADATA_VERSION } from "../scripts/metadata-version.mjs";
import { buildPlatformData } from "../scripts/release-report.mjs";

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

test("excludes image records covered by a failed target record", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gluster-catalog-failure-"));
  const records = path.join(root, "metadata/records/preview/epel");
  const failures = path.join(root, "metadata/runs/run-1/epel10-rolling/rocky/failure");
  const output = path.join(root, "metadata/catalog.json");
  await mkdir(records, { recursive: true });
  await mkdir(failures, { recursive: true });
  await writeFile(
    path.join(records, "rocky.json"),
    JSON.stringify(record({
      channel: "preview",
      distribution: "rocky",
      candidate: "epel10-rolling-11.2",
      image: {
        repository: "ghcr.io/eliware/rocky10-gluster",
        distribution: "rocky",
        package_candidate: "epel10-rolling-11.2",
        digest: "sha256:rocky",
      },
    })) + "\n",
  );
  await writeFile(
    path.join(records, "centos.json"),
    JSON.stringify(record({
      channel: "preview",
      distribution: "centos-stream",
      candidate: "epel10-rolling-11.2",
      image: {
        repository: "ghcr.io/eliware/centos10-gluster",
        distribution: "centos-stream",
        package_candidate: "epel10-rolling-11.2",
        digest: "sha256:centos",
      },
    })) + "\n",
  );
  await writeFile(
    path.join(failures, "failure-record.json"),
    JSON.stringify({
      metadata_version: METADATA_VERSION,
      lane: "epel10-rolling",
      distribution: "rocky",
      package_candidate: "epel10-rolling-11.2",
      failed_at: "2026-08-29T02:00:00Z",
    }) + "\n",
  );
  try {
    const catalog = await rebuildCatalog({ root, output });
    expect(catalog.images).toHaveLength(1);
    expect(catalog.images[0].image.digest).toBe("sha256:centos");
    const reportData = buildPlatformData([
      {
        id: "epel10-rolling",
        status: "partial",
        build: { package_format: "rpm", channel: "preview", version: "rolling" },
        images: {
          "centos-stream": {
            result: { distribution: "centos-stream", image: "centos", digest: "sha256:centos" },
          },
        },
        image_failures: [
          { distribution: "rocky", error: "EPEL metadata unavailable" },
        ],
      },
    ]);
    expect(reportData.platforms.find(({ id }) => id === "centos-stream").images).toHaveLength(1);
    expect(reportData.platforms.find(({ id }) => id === "rocky").failures).toHaveLength(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("retains a successful image rebuilt after an earlier target failure", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gluster-catalog-retry-"));
  const records = path.join(root, "metadata/records/preview/epel");
  const failures = path.join(root, "metadata/runs/run-1/epel10-rolling/rocky/failure");
  const output = path.join(root, "metadata/catalog.json");
  await mkdir(records, { recursive: true });
  await mkdir(failures, { recursive: true });
  await writeFile(
    path.join(records, "rocky-retry.json"),
    JSON.stringify(record({
      channel: "preview",
      distribution: "rocky",
      version: "11.2",
      built: "2026-08-29T03:00:00Z",
      candidate: "epel10-rolling-11.2",
      image: {
        repository: "ghcr.io/eliware/rocky10-gluster",
        distribution: "rocky",
        package_candidate: "epel10-rolling-11.2",
        digest: "sha256:rocky-retry",
      },
    })) + "\n",
  );
  await writeFile(
    path.join(failures, "failure-record.json"),
    JSON.stringify({
      metadata_version: METADATA_VERSION,
      lane: "epel10-rolling",
      distribution: "rocky",
      package_candidate: "epel10-rolling-11.2",
      failed_at: "2026-08-29T02:00:00Z",
    }) + "\n",
  );
  try {
    const catalog = await rebuildCatalog({ root, output });
    expect(catalog.images).toHaveLength(1);
    expect(catalog.images[0].image.digest).toBe("sha256:rocky-retry");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
