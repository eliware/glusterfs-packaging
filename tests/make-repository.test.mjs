import { assertScriptParses } from "./helpers/script-test.mjs";

test("make-repository.mjs parses without executing runtime side effects", async () => {
  await assertScriptParses("scripts/make-repository.mjs");
});
