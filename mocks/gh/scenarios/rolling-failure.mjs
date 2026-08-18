#!/usr/bin/env node
import { mockGh } from "../common.mjs";
await mockGh({
  outcome: ({ fields }) => (fields.channel === "rolling" ? "failed" : "passed"),
});
