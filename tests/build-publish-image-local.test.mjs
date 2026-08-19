import { assertScriptParses } from "./helpers/script-test.mjs";

test("build-publish-image-local.mjs parses without executing runtime side effects", async () => {
  await assertScriptParses("scripts/build-publish-image-local.mjs");
});
