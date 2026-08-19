import { assertScriptParses } from "./helpers/script-test.mjs";

test("write-catalog.mjs parses without executing runtime side effects", async () => {
  await assertScriptParses("scripts/write-catalog.mjs");
});
