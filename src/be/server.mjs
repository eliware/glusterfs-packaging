#!/usr/bin/env node
import { startApp } from "./app.mjs";
import { loadConfig } from "./config.mjs";
import { preloadStaticCache } from "./static-file-server.mjs";

const config = loadConfig();
const ramCacheStore = await preloadStaticCache(config);
const server = startApp({ ...config, ramCacheStore });
const shutdownTimeout =
  Number.parseInt(process.env.SHUTDOWN_TIMEOUT ?? "5000", 10) || 5000;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    const timer = setTimeout(() => process.exit(1), shutdownTimeout);
    server.close(() => {
      clearTimeout(timer);
      process.exit(0);
    });
  });
}

server.on("listening", () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 8000;
  console.log(`server listening on port ${port}`);
});

server.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
