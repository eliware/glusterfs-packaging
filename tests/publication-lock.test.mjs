import { assertScriptParses } from "./helpers/script-test.mjs";

test("publication-lock.mjs parses without executing runtime side effects", async () => {
  await assertScriptParses("scripts/publication-lock.mjs");
});
