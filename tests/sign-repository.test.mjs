import { assertScriptParses } from "./helpers/script-test.mjs";

test("sign-repository.mjs parses without executing runtime side effects", async () => {
  await assertScriptParses("scripts/sign-repository.mjs");
});
