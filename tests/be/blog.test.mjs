import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { once } from "node:events";
import { describe, expect, test } from "@jest/globals";
import { loadConfig } from "../../src/be/config.mjs";
import { createStaticRequestListener } from "../../src/be/static-file-server.mjs";
import { renderMarkdown } from "../../src/be/blog-markdown.mjs";
import { BLOG_SCHEMA, assertBlogDocument } from "../../src/be/blog-schema.mjs";
import { SUPPORTED_METADATA_VERSION } from "../../src/be/metadata-version.mjs";
import { createBlogStore, loadBlogs } from "../../src/be/blog-store.mjs";

class MockResponse extends Writable {
  constructor() {
    super();
    this.headers = {};
    this.statusCode = null;
    this.body = Buffer.alloc(0);
  }

  writeHead(statusCode, headers) {
    this.statusCode = statusCode;
    this.headers = headers;
  }

  _write(chunk, encoding, callback) {
    this.body = Buffer.concat([this.body, Buffer.from(chunk)]);
    callback();
  }
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "gluster-blog-test-"));
  const blogs = path.join(root, "blogs");
  await mkdir(blogs);
  await writeFile(
    path.join(blogs, "safe.json"),
    JSON.stringify({
      metadata_version: SUPPORTED_METADATA_VERSION,
      schema: 1,
      slug: "safe-post",
      title: "Safe <title>",
      summary: "A <summary>.",
      published_at: "2026-08-18T12:00:00Z",
      updated_at: "2026-08-18T12:00:00Z",
      author: "Eliware",
      tags: ["testing"],
      status: "published",
      content:
        "# Hello\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))",
    }),
  );
  await writeFile(
    path.join(blogs, "draft.json"),
    JSON.stringify({
      metadata_version: SUPPORTED_METADATA_VERSION,
      schema: 1,
      slug: "draft-post",
      title: "Draft",
      summary: "Not public.",
      published_at: "2026-08-19T12:00:00Z",
      updated_at: "2026-08-19T12:00:00Z",
      author: "Eliware",
      tags: ["draft"],
      status: "draft",
      content: "Draft content.",
    }),
  );
  await writeFile(
    path.join(root, "blog.html"),
    '<title>__BLOG_TITLE__</title><meta name=description content="__BLOG_DESCRIPTION__"><link rel=canonical href="__BLOG_CANONICAL__"><script type=application/ld+json>__BLOG_JSONLD__</script><footer class="site-footer">Eliware · GlusterFS packaging <a href="/metadata/catalog.json">Catalog</a> Host <code>__HOST_ID__</code></footer>',
  );
  const config = loadConfig({
    PUBLIC_DIR: root,
    STATIC_DIR: root,
    BLOG_DIR: blogs,
    ACCESS_LOG: "false",
  });
  return { listener: createStaticRequestListener(config), config, root, blogs };
}

async function request(listener, url) {
  const response = new MockResponse();
  listener({ method: "GET", url, headers: {} }, response);
  await once(response, "finish");
  return response;
}

describe("blog HTTP surface", () => {
  test("lists only published posts and returns safe rendered HTML", async () => {
    const response = await request((await fixture()).listener, "/api/v1/blogs");
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.total).toBe(1);
    expect(body.posts[0].slug).toBe("safe-post");
    expect(body.posts[0].html).toContain("<h1>Hello</h1>");
    expect(body.posts[0].html).not.toContain("<script>");
    expect(body.posts[0].html).not.toContain("javascript:");
  });

  test("renders RSS and server-side article metadata", async () => {
    const listener = (await fixture()).listener;
    const feed = await request(listener, "/feed.xml");
    expect(feed.statusCode).toBe(200);
    expect(feed.headers["Content-Type"]).toContain("application/rss+xml");
    expect(feed.body.toString()).toContain("safe-post");
    expect(feed.body.toString()).not.toContain("draft-post");

    const article = await request(listener, "/blog/safe-post");
    expect(article.statusCode).toBe(200);
    expect(article.body.toString()).toContain(
      "https://glusterfs.eliware.org/blog/safe-post",
    );
    expect(article.body.toString()).toContain('"@type":"Article"');
  });

  test("renders the standard site footer on blog pages", async () => {
    const response = await request((await fixture()).listener, "/blog");
    const body = response.body.toString();
    expect(body).toContain('class="site-footer"');
    expect(body).toContain("Eliware · GlusterFS packaging");
    expect(body).toContain('href="/metadata/catalog.json"');
    expect(body).toMatch(/Host <code>[^<]+<\/code>/);
  });

  test("renders markdown headings, lists, code, and safe links", () => {
    const html = renderMarkdown(
      "# One\n## Two\n### Three\n\n- first [link](https://example.test)\n* second **bold**\n\n```\n<value>\n```",
    );
    expect(html).toContain("<h1>One</h1>");
    expect(html).toContain("<h2>Two</h2>");
    expect(html).toContain("<h3>Three</h3>");
    expect(html).toContain('<ul><li>first <a href="https://example.test"');
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<pre><code>&lt;value&gt;");
  });

  test("normalizes CRLF markdown and leaves unsafe links as text", () => {
    const html = renderMarkdown("text\r\n\r\n[bad](javascript:alert)");
    expect(html).toContain("<p>text</p>");
    expect(html).toContain("<p>bad</p>");
    expect(html).not.toContain("javascript:");
  });

  test("escapes markdown inline markup and closes an unclosed code block", () => {
    const html = renderMarkdown(
      "<tag> & \"quote\" 'apostrophe' `code`\n\n```\nunsafe <value>",
    );
    expect(html).toContain("&lt;tag&gt;");
    expect(html).toContain("&quot;quote&quot;");
    expect(html).toContain("&#39;apostrophe&#39;");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<pre><code>unsafe &lt;value&gt;");
  });

  const validBlog = () => ({
    metadata_version: SUPPORTED_METADATA_VERSION,
    schema: BLOG_SCHEMA,
    slug: "valid-post",
    title: "Valid title",
    summary: "Valid summary",
    published_at: "2026-08-18T12:00:00Z",
    updated_at: "2026-08-18T12:00:00Z",
    author: "Eliware",
    tags: ["gluster"],
    status: "published",
    content: "Content",
  });

  test.each([
    ["missing metadata version", (blog) => delete blog.metadata_version],
    ["missing required field", (blog) => delete blog.title],
    ["legacy metadata field", (blog) => (blog.meta_version = "0.1.0")],
    ["unsupported schema", (blog) => (blog.schema = 99)],
    ["unsupported field", (blog) => (blog.extra = true)],
    ["invalid slug", (blog) => (blog.slug = "Not Valid")],
    ["invalid title", (blog) => (blog.title = " ")],
    ["null required field", (blog) => (blog.title = null)],
    ["empty required field", (blog) => (blog.title = "")],
    ["invalid timestamp format", (blog) => (blog.published_at = "yesterday")],
    [
      "invalid timestamp value",
      (blog) => (blog.published_at = "2026-99-99T12:00:00Z"),
    ],
    [
      "updated before publication",
      (blog) => (blog.updated_at = "2026-08-17T12:00:00Z"),
    ],
    ["invalid author", (blog) => (blog.author = "")],
    ["invalid tags", (blog) => (blog.tags = [""])],
    ["duplicate tags", (blog) => (blog.tags = ["same", "same"])],
    ["invalid status", (blog) => (blog.status = "private")],
    ["invalid content", (blog) => (blog.content = "")],
  ])("rejects %s blog documents", (label, mutate) => {
    const blog = validBlog();
    mutate(blog);
    expect(() => assertBlogDocument(blog, label)).toThrow();
  });

  test("uses the default blog-document validation label", () => {
    expect(assertBlogDocument(validBlog())).toEqual(validBlog());
  });

  test("loads an absent blog directory as an empty collection", async () => {
    const missing = path.join(os.tmpdir(), `missing-blog-${Date.now()}`);
    await expect(loadBlogs(missing)).resolves.toEqual([]);
    await expect(createBlogStore(missing).all()).resolves.toEqual([]);
  });

  test("sorts blog documents by date and then slug", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "blog-sort-test-"));
    const documents = [
      { ...validBlog(), slug: "z-post", published_at: "2026-08-17T12:00:00Z" },
      { ...validBlog(), slug: "b-post" },
      { ...validBlog(), slug: "a-post" },
    ];
    await Promise.all(
      documents.map((blog, index) =>
        writeFile(path.join(root, `${index}.json`), JSON.stringify(blog)),
      ),
    );
    await writeFile(path.join(root, "notes.txt"), "ignored");
    const blogs = await loadBlogs(root);
    expect(blogs.map((blog) => blog.slug)).toEqual([
      "a-post",
      "b-post",
      "z-post",
    ]);
  });

  test("rejects duplicate blog slugs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "blog-duplicate-test-"));
    const blog = validBlog();
    await writeFile(path.join(root, "a.json"), JSON.stringify(blog));
    await writeFile(path.join(root, "b.json"), JSON.stringify(blog));
    await expect(loadBlogs(root)).rejects.toThrow("duplicate blog slug");
  });

  test("reports malformed JSON with its source path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "blog-json-error-"));
    await writeFile(path.join(root, "broken.json"), "not json");
    await expect(loadBlogs(root)).rejects.toThrow("broken.json");
  });

  test("rethrows non-directory errors while loading blogs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "blog-file-error-"));
    const file = path.join(root, "not-a-directory");
    await writeFile(file, "content");
    await expect(loadBlogs(file)).rejects.toMatchObject({ code: "ENOTDIR" });
  });

  test("rethrows stat errors from a blog store", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "blog-stat-error-"));
    const file = path.join(root, "not-a-directory");
    await writeFile(file, "content");
    const store = createBlogStore(path.join(file, "blogs"));
    await expect(store.all()).rejects.toMatchObject({ code: "ENOTDIR" });
  });

  test("does not hide invalid blog-directory paths", async () => {
    const store = createBlogStore("invalid\u0000blog-path");
    await expect(store.all()).rejects.toThrow();
  });

  test("rethrows invalid blog-directory argument types", async () => {
    const store = createBlogStore(null);
    await expect(store.all()).rejects.toMatchObject({
      code: "ERR_INVALID_ARG_TYPE",
    });
  });

  test("caches blog reads and exposes published and slug lookups", async () => {
    const { blogs } = await fixture();
    const store = createBlogStore(blogs);
    const first = await store.all();
    expect(await store.all()).toBe(first);
    expect((await store.published()).map((blog) => blog.slug)).toEqual([
      "safe-post",
    ]);
    expect((await store.bySlug("safe-post")).slug).toBe("safe-post");
    expect(await store.bySlug("draft-post")).toBeNull();
    expect(await store.bySlug("missing-post")).toBeNull();
  });

  test("returns 404 for an unknown blog article", async () => {
    const response = await request((await fixture()).listener, "/blog/missing");
    expect(response.statusCode).toBe(404);
    expect(response.body.toString()).toContain("Blog post not found");
  });

  test("supports HEAD requests for blog pages", async () => {
    const listener = (await fixture()).listener;
    const response = new MockResponse();
    const finished = once(response, "finish");
    listener({ method: "HEAD", url: "/blog", headers: {} }, response);
    await finished;
    expect(response.statusCode).toBe(200);
    expect(response.headers["Content-Length"]).toBeGreaterThan(0);
    expect(response.body.length).toBe(0);
  });

  test("returns false when the blog template is unavailable", async () => {
    const { config } = await fixture();
    config.staticDir = path.join(config.staticDir, "missing");
    const response = await request(
      createStaticRequestListener(config),
      "/blog",
    );
    expect(response.statusCode).toBe(404);
  });
});
