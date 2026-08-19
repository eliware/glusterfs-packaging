import { assertScriptParses } from "./helpers/script-test.mjs";

test("reset-default.mjs parses without executing runtime side effects", async () => {
  await assertScriptParses("scripts/reset-default.mjs");
});
