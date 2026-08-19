import { assertScriptParses } from "./helpers/script-test.mjs";

test("generate-repository-index.mjs parses without executing runtime side effects", async () => {
  await assertScriptParses("scripts/generate-repository-index.mjs");
});
