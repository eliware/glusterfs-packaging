import { assertScriptParses } from "./helpers/script-test.mjs";

test("build-rpms.mjs parses without executing runtime side effects", async () => {
  await assertScriptParses("scripts/build-rpms.mjs");
});
