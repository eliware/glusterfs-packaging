import { assertScriptParses } from "./helpers/script-test.mjs";

test("build-debs.mjs parses without executing runtime side effects", async () => {
  await assertScriptParses("scripts/build-debs.mjs");
});
