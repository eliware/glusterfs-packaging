import { assertScriptParses } from "./helpers/script-test.mjs";

test("conductor-config.mjs parses without executing runtime side effects", async () => {
  await assertScriptParses("scripts/conductor-config.mjs");
});
