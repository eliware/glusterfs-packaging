import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("writes a hashed provenance record and checksum list", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "gluster-provenance-test-"),
  );
  const output = path.join(root, "record");
  const record = path.join(root, "record.json");
  const asset = path.join(root, "build.log");
  try {
    await writeFile(record, '{"kind":"test","run_id":"test-run"}\n');
    await writeFile(asset, "build completed\n");
    await execFileAsync(
      process.execPath,
      [
        "scripts/write-provenance.mjs",
        "--output-dir",
        output,
        "--record-json",
        record,
        "--asset",
        "build-log",
        asset,
      ],
      { env: { ...process.env, PROVENANCE_ALLOW_UNSIGNED: "1" } },
    );
    const provenance = JSON.parse(
      await readFile(path.join(output, "provenance.json"), "utf8"),
    );
    const checksums = await readFile(
      path.join(output, "checksums.sha256"),
      "utf8",
    );
    const expected = createHash("sha256")
      .update("build completed\n")
      .digest("hex");
    expect(provenance.schema).toBe(1);
    expect(provenance.files).toHaveLength(1);
    expect(provenance.files[0].sha256).toBe(expected);
    expect(checksums).toContain(`${expected}  assets/build.log`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
