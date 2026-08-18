#!/usr/bin/env node
import { mockGh } from "../common.mjs";
await mockGh({
  outcome: ({ workflow }) =>
    workflow === "rpm-package-build.yml" ? "failed" : "passed",
});
