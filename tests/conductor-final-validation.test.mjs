import { assertScriptParses } from "./helpers/script-test.mjs";

test("conductor-final-validation.mjs parses without executing runtime side effects", async () => {
  await assertScriptParses("scripts/conductor-final-validation.mjs");
});
