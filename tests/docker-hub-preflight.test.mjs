import { assertScriptParses } from "./helpers/script-test.mjs";

test("docker-hub-preflight.mjs parses without executing runtime side effects", async () => {
  await assertScriptParses("scripts/docker-hub-preflight.mjs");
});
