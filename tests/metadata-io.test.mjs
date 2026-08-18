import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readMetadata, writeMetadata } from "../scripts/metadata-io.mjs";
import { METADATA_VERSION } from "../scripts/metadata-version.mjs";

test("metadata IO versions and validates documents", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "gluster-metadata-io-"),
  );
  const file = path.join(directory, "record.json");
  try {
    await writeMetadata(
      file,
      { schema: 1, run_id: "run-1" },
      { required: ["run_id"] },
    );
    const record = await readMetadata(file, { required: ["run_id"] });
    expect(record.metadata_version).toBe(METADATA_VERSION);
    expect(record.run_id).toBe("run-1");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("metadata IO can explicitly allow missing files", async () => {
  const file = path.join(
    os.tmpdir(),
    `gluster-metadata-missing-${Date.now()}.json`,
  );
  await expect(readMetadata(file, { allowMissing: true })).resolves.toBeNull();
});
