import { staticFileExists } from "./file-access.mjs";
import { fileHeaders } from "./response.mjs";
import { compressBody } from "./response.mjs";
import { promises as fs } from "node:fs";
import { servingHostId } from "./runtime-identity.mjs";

export async function serveStaticFile(response, request, requestPath, config) {
  const file = await staticFileExists(config.staticDir, requestPath, config);
  if (!file) return false;
  const headers = {
    ...fileHeaders(file.path, file.stats, config),
    "Cache-Control": requestPath.startsWith("/web/")
      ? "public, max-age=60, must-revalidate"
      : requestPath.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "public, max-age=60",
  };
  let body = await fs.readFile(file.path);
  if (file.path.endsWith(".html"))
    body = Buffer.from(
      body.toString("utf8").replaceAll("__HOST_ID__", servingHostId()),
    );
  if (request.method === "HEAD") {
    response.writeHead(200, { ...headers, "Content-Length": body.length });
    response.end();
    return true;
  }
  const encoded = await compressBody(
    body,
    request,
    headers["Content-Type"],
    config,
  );
  response.writeHead(200, {
    ...headers,
    "Content-Length": encoded.body.length,
    ...encoded.headers,
  });
  response.end(encoded.body);
  return true;
}
