import { readFile } from "node:fs/promises";
import path from "node:path";
import { compressBody, fileHeaders, sendError } from "./response.mjs";
import { servingHostId } from "./runtime-identity.mjs";

const SITE_URL = "https://glusterfs.eliware.org";

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function jsonLd(blog) {
  const value = blog
    ? {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: blog.title,
        description: blog.summary,
        datePublished: blog.published_at,
        dateModified: blog.updated_at,
        author: { "@type": "Organization", name: blog.author },
        mainEntityOfPage: `${SITE_URL}/blog/${blog.slug}`,
      }
    : {
        "@context": "https://schema.org",
        "@type": "Blog",
        name: "Eliware GlusterFS blog",
        description: "News, guides, and release notes from Eliware GlusterFS.",
        url: `${SITE_URL}/blog`,
      };
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

export async function serveBlogPage(response, request, requestPath, config) {
  const slug = requestPath.replace(/^\/blog\/?/, "");
  const blog = slug ? await config.blogStore.bySlug(slug) : null;
  if (slug && !blog) {
    await sendError(response, 404, "Blog post not found", config);
    return true;
  }
  const file = path.join(config.staticDir, "blog.html");
  let body;
  try {
    body = await readFile(file, "utf8");
  } catch {
    return false;
  }
  const title = blog
    ? `${blog.title} · Eliware GlusterFS`
    : "Blog · Eliware GlusterFS";
  const description =
    blog?.summary || "Eliware GlusterFS news, guides, and release notes.";
  const canonical = `${SITE_URL}/blog${blog ? `/${blog.slug}` : ""}`;
  body = body
    .replaceAll("__BLOG_TITLE__", escapeAttribute(title))
    .replaceAll("__BLOG_DESCRIPTION__", escapeAttribute(description))
    .replaceAll("__BLOG_CANONICAL__", escapeAttribute(canonical))
    .replaceAll("__BLOG_OG_TYPE__", blog ? "article" : "website")
    .replaceAll("__BLOG_JSONLD__", jsonLd(blog))
    .replaceAll("__HOST_ID__", servingHostId());
  const buffer = Buffer.from(body);
  const headers = {
    ...fileHeaders(
      file,
      { size: buffer.length, mtime: new Date(), mtimeMs: Date.now() },
      config,
    ),
    "Cache-Control": "public, max-age=60, must-revalidate",
  };
  if (request.method === "HEAD") {
    response.writeHead(200, { ...headers, "Content-Length": buffer.length });
    response.end();
    return true;
  }
  const encoded = await compressBody(
    buffer,
    request,
    "text/html; charset=utf-8",
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
