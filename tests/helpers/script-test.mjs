import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function assertScriptParses(script) {
  await expect(
    execFileAsync(process.execPath, ["--check", script], {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024,
    }),
  ).resolves.toEqual(expect.objectContaining({ stdout: "", stderr: "" }));
}
