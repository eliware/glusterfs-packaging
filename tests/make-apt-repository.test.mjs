import { assertScriptParses } from "./helpers/script-test.mjs";

test("make-apt-repository.mjs parses without executing runtime side effects", async () => {
  await assertScriptParses("scripts/make-apt-repository.mjs");
});
