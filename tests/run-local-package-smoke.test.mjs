import { assertScriptParses } from "./helpers/script-test.mjs";

test("run-local-package-smoke.mjs parses without executing runtime side effects", async () => {
  await assertScriptParses("scripts/run-local-package-smoke.mjs");
});
