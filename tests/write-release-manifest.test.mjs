import { assertScriptParses } from "./helpers/script-test.mjs";

test("write-release-manifest.mjs parses without executing runtime side effects", async () => {
  await assertScriptParses("scripts/write-release-manifest.mjs");
});
