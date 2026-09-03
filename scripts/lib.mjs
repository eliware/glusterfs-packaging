import { execFile, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
  access,
  appendFile,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export const execFileAsync = promisify(execFile);
export const repoRoot =
  process.env.REPO_ROOT ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function env(name, fallback = "") {
  return process.env[name] ?? fallback;
}

async function trace(event, fields = {}) {
  const file = process.env.CONDUCTOR_TRACE_LOG;
  if (!file) return;
  try {
    await appendFile(
      file,
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        pid: process.pid,
        event,
        ...fields,
      })}\n`,
    );
  } catch {
    // Diagnostics must never change the build result.
  }
}

export function required(value, message) {
  if (!value) throw new Error(message);
  return value;
}
export async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
export async function ensureDir(directory) {
  await mkdir(directory, { recursive: true });
  return directory;
}
export async function remove(target) {
  await rm(target, { recursive: true, force: true });
}
export async function copy(source, destination) {
  await copyFile(source, destination);
}

export async function run(command, args = [], options = {}) {
  if (options.stream) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      void trace("command-start", { command, args, cwd: options.cwd || process.cwd() });
      const logStream = options.logFile
        ? createWriteStream(options.logFile, { flags: "a" })
        : null;
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env || process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const record = (chunk, name) => {
        if (logStream) logStream.write(chunk);
        if (options.captureStream !== false) {
          if (name === "stdout") stdout += chunk;
          else stderr += chunk;
        }
        if (!options.silent)
          (name === "stdout" ? process.stdout : process.stderr).write(chunk);
      };
      child.stdout.on("data", (chunk) => {
        record(chunk, "stdout");
      });
      child.stderr.on("data", (chunk) => {
        record(chunk, "stderr");
      });
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        const finish = () => {
          void trace("command-end", {
            command,
            args,
            exitCode: code,
            signal,
            durationMs: Date.now() - started,
            stdout,
            stderr,
          });
          if (code === 0) resolve({ stdout, stderr });
          else {
            const error = new Error(
              `${command} exited with ${code ?? signal}${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
            );
            error.code = code;
            error.signal = signal;
            error.stdout = stdout;
            error.stderr = stderr;
            reject(error);
          }
        };
        if (logStream) logStream.end(finish);
        else finish();
      });
    });
  }
  const started = Date.now();
  void trace("command-start", { command, args, cwd: options.cwd || process.cwd() });
  let result;
  try {
    result = await execFileAsync(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      maxBuffer: 64 * 1024 * 1024,
      timeout: options.timeout,
    });
  } catch (error) {
    await trace("command-end", {
      command,
      args,
      exitCode: error.code,
      signal: error.signal,
      durationMs: Date.now() - started,
      stdout: error.stdout || "",
      stderr: error.stderr || "",
      error: error.message,
    });
    throw error;
  }
  const { stdout, stderr } = result;
  await trace("command-end", {
    command,
    args,
    exitCode: 0,
    durationMs: Date.now() - started,
    stdout,
    stderr,
  });
  if (options.capture) return { stdout, stderr };
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  return { stdout, stderr };
}

export function runInteractive(command, args = [], options = {}) {
  const suppress = options.suppress || [];
  const filtered = suppress.length > 0 || options.logFile || options.silent;
  return new Promise((resolve, reject) => {
    const started = Date.now();
    void trace("command-start", { command, args, cwd: options.cwd || process.cwd() });
    const buffers = { stdout: "", stderr: "" };
    const logStream = options.logFile
      ? createWriteStream(options.logFile, { flags: "a" })
      : null;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: filtered
        ? [options.input ? "pipe" : "ignore", "pipe", "pipe"]
        : options.input
          ? ["pipe", "inherit", "inherit"]
          : "inherit",
    });
    const writeFiltered = (stream, name, chunk) => {
      buffers[name] += chunk.toString();
      if (logStream) logStream.write(chunk);
      const lines = buffers[name].split(/\r?\n/);
      buffers[name] = lines.pop() || "";
      for (const line of lines)
        if (!options.silent && !suppress.some((pattern) => pattern.test(line)))
          stream.write(`${line}\n`);
    };
    if (filtered) {
      child.stdout.on("data", (chunk) =>
        writeFiltered(process.stdout, "stdout", chunk),
      );
      child.stderr.on("data", (chunk) =>
        writeFiltered(process.stderr, "stderr", chunk),
      );
    }
    if (options.input) {
      child.stdin.write(options.input);
      child.stdin.end();
    }
    child.once("error", (error) => {
      error.command = command;
      error.args = args;
      error.stdout = buffers.stdout;
      error.stderr = buffers.stderr;
      void trace("command-end", {
        command,
        args,
        durationMs: Date.now() - started,
        error: error.message,
        stdout: buffers.stdout,
        stderr: buffers.stderr,
      }).finally(() => reject(error));
    });
    child.once("exit", (code, signal) => {
      if (filtered && !options.silent) {
        for (const [name, buffer] of Object.entries(buffers))
          if (buffer && !suppress.some((pattern) => pattern.test(buffer)))
            (name === "stdout" ? process.stdout : process.stderr).write(buffer);
      }
      const finish = () => {
        void trace("command-end", {
          command,
          args,
          exitCode: code,
          signal,
          durationMs: Date.now() - started,
          stdout: buffers.stdout,
          stderr: buffers.stderr,
        });
        if (code === 0) resolve({ stdout: buffers.stdout, stderr: buffers.stderr });
        else {
          const commandLine = [command, ...args].join(" ");
          const summarize = (value) => {
            const text = value.trim();
            if (!text) return "";
            return text.length > 4000
              ? `${text.slice(-4000)} (last 4000 characters)`
              : text;
          };
          const error = new Error(
            `${commandLine} exited with ${code ?? signal}` +
              (summarize(buffers.stderr)
                ? `: ${summarize(buffers.stderr)}`
                : summarize(buffers.stdout)
                  ? `: ${summarize(buffers.stdout)}`
                  : ""),
          );
          error.code = code;
          error.signal = signal;
          error.command = command;
          error.args = args;
          error.stdout = buffers.stdout;
          error.stderr = buffers.stderr;
          reject(error);
        }
      };
      if (logStream) logStream.end(finish);
      else finish();
    });
  });
}

export async function commandExists(command) {
  try {
    await run("which", [command], { capture: true });
    return true;
  } catch {
    return false;
  }
}

export async function parseEnvFile(file) {
  const values = {};
  for (const raw of (await readFile(file, "utf8")).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

export async function tempDir(prefix = "gluster-packaging-") {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}
export async function files(directory, predicate = () => true) {
  return (await readdir(directory, { withFileTypes: true }))
    .filter(predicate)
    .map((entry) => path.join(directory, entry.name));
}
export async function atomicWrite(file, contents) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.next`;
  await writeFile(temporary, contents);
  await import("node:fs/promises").then(({ rename }) =>
    rename(temporary, file),
  );
}
