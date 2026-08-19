import { assertScriptParses } from "./helpers/script-test.mjs";

test("verify-provenance.mjs parses without executing runtime side effects", async () => {
  await assertScriptParses("scripts/verify-provenance.mjs");
});
