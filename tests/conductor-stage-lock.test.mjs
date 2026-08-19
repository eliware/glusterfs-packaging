import { assertScriptParses } from "./helpers/script-test.mjs";

test("conductor-stage-lock.mjs parses without executing runtime side effects", async () => {
  await assertScriptParses("scripts/conductor-stage-lock.mjs");
});
