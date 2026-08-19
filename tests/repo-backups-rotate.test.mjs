import { assertScriptParses } from "./helpers/script-test.mjs";

test("repo-backups-rotate.mjs parses without executing runtime side effects", async () => {
  await assertScriptParses("scripts/repo-backups-rotate.mjs");
});
