import { readFile } from "node:fs/promises";

test("passes candidateRoot into smoke-2 target execution", async () => {
  const source = await readFile("scripts/package-lane.mjs", "utf8");
  expect(source).toContain("candidateRoot,\n        target_os,");
  expect(source).toContain("candidateRoot,\n  target_os,");
  expect(source).toContain('UNSIGNED_CANDIDATE: candidateRoot ? "1" : "0"');
});
