import { assertScriptParses } from "./helpers/script-test.mjs";

test("publish-package-candidate.mjs parses without executing runtime side effects", async () => {
  await assertScriptParses("scripts/publish-package-candidate.mjs");
});
