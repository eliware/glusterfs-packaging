import http from "node:http";
import { createStaticRequestListener } from "./static-file-server.mjs";

export function createHttpServer(config) {
  const requestListener = createStaticRequestListener(config);
  const server = http.createServer(requestListener);
  server.requestTimeout = config.requestTimeout;
  server.headersTimeout = config.headersTimeout;
  server.keepAliveTimeout = config.keepAliveTimeout;
  return server.listen(config.port, config.host);
}
