import { assertScriptParses } from "./helpers/script-test.mjs";

test("dispatch-workflow.mjs parses without executing runtime side effects", async () => {
  await assertScriptParses("scripts/dispatch-workflow.mjs");
});
