import { assertScriptParses } from "./helpers/script-test.mjs";

test("backup-repository.mjs parses without executing runtime side effects", async () => {
  await assertScriptParses("scripts/backup-repository.mjs");
});
