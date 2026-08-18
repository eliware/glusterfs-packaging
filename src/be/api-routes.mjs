import { repositoryDirectory } from "./repository-directory.mjs";
import { sendJson } from "./response.mjs";
import { renderBlogArticle } from "./blog-markdown.mjs";
import { SUPPORTED_METADATA_VERSION } from "./metadata-version.mjs";

function publicBlog(blog) {
  return { ...blog, html: renderBlogArticle(blog) };
}

export async function handleBlogApi(response, requestPath, config) {
  const collectionPath = "/api/v1/blogs";
  const prefix = `${collectionPath}/`;
  const isCollection = requestPath === collectionPath;
  const isArticle = requestPath.startsWith(prefix);
  if (!isCollection && !isArticle) return false;
  try {
    if (isArticle) {
      const slug = requestPath.slice(prefix.length);
      if (!slug || slug.includes("/")) throw new Error("invalid blog slug");
      const blog = await config.blogStore.bySlug(slug);
      if (!blog) {
        sendJson(
          response,
          404,
          { error: "blog post not found" },
          config,
          "no-store",
        );
        return true;
      }
      sendJson(
        response,
        200,
        publicBlog(blog),
        config,
        "public, max-age=60, must-revalidate",
      );
      return true;
    }
    const posts = await config.blogStore.published();
    sendJson(
      response,
      200,
      {
        metadata_version: SUPPORTED_METADATA_VERSION,
        schema: 1,
        posts: posts.map(publicBlog),
        total: posts.length,
      },
      config,
      "public, max-age=60, must-revalidate",
    );
  } catch {
    sendJson(
      response,
      503,
      { error: "blog metadata unavailable" },
      config,
      "no-store",
    );
  }
  return true;
}

export async function handleDirectoryApi(
  request,
  response,
  requestPath,
  config,
) {
  if (requestPath !== "/api/v1/list") return false;
  const query = new URL(request.url || "/", "http://localhost").searchParams;
  const requestedPath = query.get("path") || "/";
  let listing;
  try {
    const normalizedPath = requestedPath.startsWith("/")
      ? requestedPath
      : `/${requestedPath}`;
    listing = await repositoryDirectory(config, normalizedPath, {
      query: query.get("q") || "",
      sort: query.get("sort") || "name",
      order: query.get("order") || "asc",
      offset: query.get("offset") || "0",
      limit: query.get("limit") || "500",
    });
  } catch {
    listing = null;
  }
  if (!listing)
    sendJson(
      response,
      404,
      { error: "directory not found" },
      config,
      "no-store",
    );
  else sendJson(response, 200, listing, config);
  return true;
}
