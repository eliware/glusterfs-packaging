import { loadConfig } from "./config.mjs";
import { createHttpServer } from "./http-server.mjs";

export function startApp(options = {}) {
  return createHttpServer({ ...loadConfig(), ...options });
}
