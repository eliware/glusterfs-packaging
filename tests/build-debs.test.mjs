import { assertScriptParses } from "./helpers/script-test.mjs";
import { pythonPatchAction } from "../scripts/python-patch.mjs";

test("build-debs.mjs parses without executing runtime side effects", async () => {
  await assertScriptParses("scripts/build-debs.mjs");
});

test("python patch handles old, updated, and removed macro files", () => {
  expect(pythonPatchAction("sys.version[[:3]]")).toBe("apply");
  expect(pythonPatchAction("sys.version[[:4]]")).toBe("skip-applied");
  expect(pythonPatchAction(null)).toBe("skip-missing");
});
