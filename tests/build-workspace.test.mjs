import { assertScriptParses } from "./helpers/script-test.mjs";

test("build-workspace.mjs parses without executing runtime side effects", async () => {
  await assertScriptParses("scripts/build-workspace.mjs");
});
