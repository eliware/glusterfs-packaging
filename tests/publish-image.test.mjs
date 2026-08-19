import { assertScriptParses } from "./helpers/script-test.mjs";

test("publish-image.mjs parses without executing runtime side effects", async () => {
  await assertScriptParses("scripts/publish-image.mjs");
});
