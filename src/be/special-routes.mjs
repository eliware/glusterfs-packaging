import { handleBlogApi, handleDirectoryApi } from "./api-routes.mjs";
import { handleCatalogRoute, handleHealthRoute } from "./health-routes.mjs";
import { serveStaticFile } from "./static-assets.mjs";
import { renderBlogRss } from "./blog-rss.mjs";
import { baseHeaders } from "./response.mjs";
import { serveBlogPage } from "./blog-pages.mjs";

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function renderSitemap(posts) {
  const urls = [
    "/",
    "/el10/x86_64/",
    "/el10/",
    "/about",
    "/blog",
    "/feed.xml",
    "/tos",
    "/policy",
    ...posts.map((post) => `/blog/${encodeURIComponent(post.slug)}`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map(
      (url) =>
        `  <url><loc>${escapeXml(`https://glusterfs.eliware.org${url}`)}</loc></url>`,
    )
    .join("\n")}\n</urlset>\n`;
}

export async function handleSpecialRequest(
  request,
  response,
  requestPath,
  config,
) {
  if (await handleHealthRoute(request, response, requestPath, config))
    return true;
  if (await handleCatalogRoute(response, requestPath, config)) return true;
  if (await handleDirectoryApi(request, response, requestPath, config))
    return true;
  if (await handleBlogApi(response, requestPath, config)) return true;
  if (requestPath === "/feed.xml") {
    try {
      const body = renderBlogRss(await config.blogStore.published());
      response.writeHead(200, {
        ...baseHeaders(config),
        "Content-Type": "application/rss+xml; charset=utf-8",
        "Cache-Control": "public, max-age=300, must-revalidate",
        "Content-Length": Buffer.byteLength(body),
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      response.writeHead(503, {
        ...baseHeaders(config),
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end("blog feed unavailable\n");
    }
    return true;
  }
  if (requestPath === "/sitemap.xml") {
    try {
      const body = renderSitemap(await config.blogStore.published());
      response.writeHead(200, {
        ...baseHeaders(config),
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=60, must-revalidate",
        "Content-Length": Buffer.byteLength(body),
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      response.writeHead(503, {
        ...baseHeaders(config),
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end("sitemap unavailable\n");
    }
    return true;
  }
  if (
    requestPath === "/blog" ||
    requestPath === "/blog/" ||
    requestPath.startsWith("/blog/")
  )
    return serveBlogPage(response, request, requestPath, config);
  if (
    requestPath === "/" ||
    requestPath === "/browse" ||
    requestPath === "/browse/" ||
    requestPath.startsWith("/web/") ||
    requestPath.startsWith("/assets/") ||
    requestPath === "/robots.txt"
  ) {
    return serveStaticFile(
      response,
      request,
      requestPath === "/browse" || requestPath === "/browse/"
        ? "/browse.html"
        : requestPath,
      config,
    );
  }
  const informationPages = new Map([
    ["/about", "/about.html"],
    ["/about/", "/about.html"],
    ["/tos", "/tos.html"],
    ["/tos/", "/tos.html"],
    ["/policy", "/policy.html"],
    ["/policy/", "/policy.html"],
  ]);
  if (informationPages.has(requestPath))
    return serveStaticFile(
      response,
      request,
      informationPages.get(requestPath),
      config,
    );
  return false;
}
