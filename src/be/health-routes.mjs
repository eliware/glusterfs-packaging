import path from "node:path";
import { promises as fs } from "node:fs";
import { sendJson } from "./response.mjs";
import { renderMetrics } from "./metrics.mjs";
import { assertMetadataVersion } from "./metadata-version.mjs";

export async function handleHealthRoute(
  request,
  response,
  requestPath,
  config,
) {
  if (requestPath === "/health" || requestPath === "/healthz") {
    sendJson(response, 200, { status: "ok" }, config, "no-store");
    return true;
  }
  if (requestPath === "/metrics") {
    response.writeHead(200, {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(request.method === "HEAD" ? undefined : renderMetrics());
    return true;
  }
  if (requestPath !== "/ready" && requestPath !== "/readyz") return false;
  return checkReadiness(response, config);
}

async function checkReadiness(response, config) {
  let catalog = false;
  try {
    assertMetadataVersion(
      JSON.parse(
        await fs.readFile(
          path.join(config.publicDir, "metadata/catalog.json"),
          "utf8",
        ),
      ),
      "catalog.json",
    );
    catalog = true;
  } catch {}
  let index = false;
  try {
    assertMetadataVersion(
      JSON.parse(
        await fs.readFile(
          path.join(config.publicDir, "metadata/repository-index.json"),
          "utf8",
        ),
      ),
      "repository-index.json",
    );
    index = true;
  } catch {}
  let active = null;
  try {
    active = assertMetadataVersion(
      JSON.parse(
        await fs.readFile(
          path.join(config.publicDir, "metadata/active-generation.json"),
          "utf8",
        ),
      ),
      "active-generation.json",
    );
    await fs.access(
      path.join(
        config.publicDir,
        ".generations",
        active.generation,
        "generation.json",
      ),
    );
  } catch {
    active = null;
  }
  const ready = Boolean(catalog && index && active?.generation);
  sendJson(
    response,
    ready ? 200 : 503,
    {
      status: ready ? "ready" : "not-ready",
      generation: active?.generation || null,
    },
    config,
    "no-store",
  );
  return true;
}

export async function handleCatalogRoute(response, requestPath, config) {
  if (requestPath !== "/api/v1/catalog") return false;
  try {
    sendJson(
      response,
      200,
      assertMetadataVersion(
        JSON.parse(
          await fs.readFile(
            path.join(config.publicDir, "metadata/catalog.json"),
            "utf8",
          ),
        ),
        "catalog.json",
      ),
      config,
    );
  } catch {
    sendJson(
      response,
      503,
      { error: "catalog unavailable" },
      config,
      "no-store",
    );
  }
  return true;
}
