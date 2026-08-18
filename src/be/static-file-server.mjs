import { loadConfig } from "./config.mjs";
import { preloadStaticCache } from "./file-access.mjs";
import { createRequestListener } from "./request-listener.mjs";

export { preloadStaticCache };

export function createStaticRequestListener(options) {
  const config =
    typeof options === "string"
      ? { ...loadConfig(), publicDir: options }
      : options;
  return createRequestListener(config);
}
