import { assertScriptParses } from "./helpers/script-test.mjs";

test("publish-candidate.mjs parses without executing runtime side effects", async () => {
  await assertScriptParses("scripts/publish-candidate.mjs");
});
