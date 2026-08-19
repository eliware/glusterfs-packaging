import { assertScriptParses } from "./helpers/script-test.mjs";

test("conductor-image-plan.mjs parses without executing runtime side effects", async () => {
  await assertScriptParses("scripts/conductor-image-plan.mjs");
});
