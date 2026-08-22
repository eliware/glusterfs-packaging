import { assertScriptParses } from "./helpers/script-test.mjs";

test("backup-repository.mjs parses without executing runtime side effects", async () => {
  await assertScriptParses("scripts/backup-repository.mjs");
});

test("commit-publish-repository.mjs parses without executing Git side effects", async () => {
  await assertScriptParses("scripts/commit-publish-repository.mjs");
});
