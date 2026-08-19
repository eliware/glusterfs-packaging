import { assertScriptParses } from "./helpers/script-test.mjs";

test("conductor-service.mjs parses without executing runtime side effects", async () => {
  await assertScriptParses("scripts/conductor-service.mjs");
});
