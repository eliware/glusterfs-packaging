#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";

if (process.argv.length > 2) {
  const child = spawn(process.argv[2], process.argv.slice(3), {
    stdio: "inherit",
  });
  child.once("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
} else {
  const required = (name) => {
    if (!process.env[name]) throw new Error(`${name} is required`);
    return process.env[name];
  };
  const nodeName = required("GLUSTER_NODE_NAME");
  required("GLUSTER_REPOSITORY_BRICKS");
  const peers = (process.env.GLUSTER_PEERS || "").split(/\s+/).filter(Boolean);
  const volume = process.env.GLUSTER_REPOSITORY_VOLUME || "repository";
  const replica = process.env.GLUSTER_REPOSITORY_REPLICA_COUNT || "3";
  const create =
    (process.env.GLUSTER_BOOTSTRAP_CREATE_VOLUME || "false").toLowerCase() ===
    "true";
  await mkdir("/run/gluster", { recursive: true });
  await mkdir("/var/log/glusterfs", { recursive: true });
  const daemon = spawn(
    "glusterd",
    ["--no-daemon", "--pid-file=/run/gluster/glusterd.pid"],
    { stdio: "inherit" },
  );
  const stop = () => daemon.kill();
  process.once("exit", stop);
  process.once("SIGTERM", () => {
    stop();
    process.exit(143);
  });
  process.once("SIGINT", () => {
    stop();
    process.exit(130);
  });
  while (true) {
    try {
      await run("gluster", ["--mode=script", "peer", "status"]);
      break;
    } catch {
      if (daemon.exitCode !== null) process.exit(1);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  for (const peer of peers)
    if (peer !== nodeName)
      await run("gluster", ["--mode=script", "peer", "probe", peer]).catch(
        () => {},
      );
  if (create) {
    let info = true;
    try {
      await run("gluster", ["--mode=script", "volume", "info", volume]);
    } catch {
      info = false;
    }
    if (!info) {
      const bricks =
        process.env.GLUSTER_REPOSITORY_BRICKS.split(/\s+/).filter(Boolean);
      if (!bricks.length) throw new Error("no repository bricks configured");
      await run("gluster", [
        "--mode=script",
        "volume",
        "create",
        volume,
        "replica",
        replica,
        "transport",
        "tcp",
        ...bricks,
        "force",
      ]);
    }
    await run("gluster", ["--mode=script", "volume", "start", volume]).catch(
      () => {},
    );
  }
  await new Promise((resolve) => daemon.once("exit", resolve));
}
async function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} failed`)),
    );
  });
}
