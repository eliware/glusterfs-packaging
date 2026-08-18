#!/usr/bin/env node
import { mockGh } from "../common.mjs";
await mockGh({
  outcome: ({ workflow }) =>
    workflow === "deb-package-build.yml" ? "failed" : "passed",
});
