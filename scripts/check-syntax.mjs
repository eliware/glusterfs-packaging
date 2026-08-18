#!/usr/bin/env node
import { readdir } from "node:fs/promises";
import path from "node:path";
import { runInteractive } from "./lib.mjs";
for (const directory of ["scripts", "tests", "containers"]) {
  for (const file of (await readdir(directory)).filter((name) =>
    name.endsWith(".mjs"),
  ))
    await runInteractive(process.execPath, [
      "--check",
      path.join(directory, file),
    ]);
}
