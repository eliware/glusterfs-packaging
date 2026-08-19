import { assertScriptParses } from "./helpers/script-test.mjs";

test("sign-apt-repositories.mjs parses without executing runtime side effects", async () => {
  await assertScriptParses("scripts/sign-apt-repositories.mjs");
});
