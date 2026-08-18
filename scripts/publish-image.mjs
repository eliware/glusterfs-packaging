#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { env, required, run, runInteractive } from "./lib.mjs";
const image = required(process.argv[2], "usage: publish-image.mjs IMAGE");
const registry = env("GHCR_REGISTRY", "ghcr.io");
const runtime = env("CONTAINER_RUNTIME", "docker");
if (!image.startsWith(`${registry}/`))
  throw new Error(`image must be hosted at ${registry}: ${image}`);
let user = env("GHCR_USER");
let token;
if (env("GHCR_TOKEN_FILE")) {
  token = (await readFile(env("GHCR_TOKEN_FILE"), "utf8")).trim();
  user ||= "eliware";
} else {
  user ||= (
    await run("gh", ["api", "user", "--jq", ".login"], { capture: true })
  ).stdout.trim();
  token = (await run("gh", ["auth", "token"], { capture: true })).stdout.trim();
}
await runInteractive(
  runtime,
  ["login", registry, "--username", user, "--password-stdin"],
  { input: token },
);
await runInteractive(runtime, ["push", image]);
const digest = (
  await run(
    runtime,
    [
      "image",
      "inspect",
      image,
      "--format",
      "{{range .RepoDigests}}{{println .}}{{end}}",
    ],
    { capture: true },
  )
).stdout
  .split("\n")
  .map((line) => line.trim())
  .find((line) => line.startsWith(`${image.split(":")[0]}@sha256:`))
  ?.split("@")[1];
if (!digest) throw new Error(`could not determine pushed digest for ${image}`);
console.log(digest);
