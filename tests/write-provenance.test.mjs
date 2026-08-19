import { assertScriptParses } from "./helpers/script-test.mjs";

test("write-provenance.mjs parses without executing runtime side effects", async () => {
  await assertScriptParses("scripts/write-provenance.mjs");
});
