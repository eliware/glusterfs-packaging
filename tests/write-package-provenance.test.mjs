import { assertScriptParses } from "./helpers/script-test.mjs";

test("write-package-provenance.mjs parses without executing runtime side effects", async () => {
  await assertScriptParses("scripts/write-package-provenance.mjs");
});
