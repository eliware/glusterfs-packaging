import { assertScriptParses } from "./helpers/script-test.mjs";

test("check-syntax.mjs parses without executing runtime side effects", async () => {
  await assertScriptParses("scripts/check-syntax.mjs");
});
