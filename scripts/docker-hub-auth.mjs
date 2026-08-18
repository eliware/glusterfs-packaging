import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { execFileAsync } from "./lib.mjs";

const DOCKER_HUB_REGISTRIES = [
  "https://index.docker.io/v1/",
  "https://index.docker.io/v1",
  "index.docker.io",
  "registry-1.docker.io",
  "docker.io",
];

function dockerConfigFile() {
  const configDirectory =
    process.env.DOCKER_CONFIG || path.join(os.homedir(), ".docker");
  return path.join(configDirectory, "config.json");
}

function configRegistryEntry(config, property) {
  for (const registry of DOCKER_HUB_REGISTRIES) {
    if (config[property]?.[registry]) return config[property][registry];
  }
  return undefined;
}

function decodeAuth(value) {
  if (!value) return null;
  const decoded = Buffer.from(value, "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator < 1) return null;
  return {
    username: decoded.slice(0, separator),
    password: decoded.slice(separator + 1),
  };
}

async function readCredentialHelper(config, registry) {
  const helper = config.credHelpers?.[registry] || config.credsStore;
  if (!helper) return null;
  try {
    const { stdout } = await execFileAsync(
      `docker-credential-${helper}`,
      ["get"],
      {
        input: `${JSON.stringify({ ServerURL: registry })}\n`,
        maxBuffer: 1024 * 1024,
      },
    );
    const credential = JSON.parse(stdout);
    if (!credential.Username || !credential.Secret) return null;
    return { username: credential.Username, password: credential.Secret };
  } catch {
    return null;
  }
}

export async function readDockerHubCredentials() {
  if (process.env.DOCKERHUB_USERNAME && process.env.DOCKERHUB_TOKEN)
    return {
      username: process.env.DOCKERHUB_USERNAME,
      password: process.env.DOCKERHUB_TOKEN,
    };

  let config;
  try {
    config = JSON.parse(await readFile(dockerConfigFile(), "utf8"));
  } catch {
    return null;
  }

  const auth = configRegistryEntry(config, "auths")?.auth;
  const decoded = decodeAuth(auth);
  if (decoded) return decoded;
  for (const registry of DOCKER_HUB_REGISTRIES) {
    const credential = await readCredentialHelper(config, registry);
    if (credential) return credential;
  }
  return null;
}

export function dockerAuthFile() {
  const file = dockerConfigFile();
  return existsSync(file) ? file : null;
}

export function dockerHubBasicAuthorization(credentials) {
  return `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`;
}
