import { getElement } from "./dom.mjs";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(value) {
  return dateFormatter.format(new Date(value));
}

function postCard(post) {
  const tags = post.tags
    .map((tag) => `<span class="blog-tag">${escapeHtml(tag)}</span>`)
    .join("");
  return `<article class="blog-card"><p class="blog-date">${formatDate(post.published_at)}</p><h2><a href="/blog/${encodeURIComponent(post.slug)}">${escapeHtml(post.title)}</a></h2><p>${escapeHtml(post.summary)}</p><div class="blog-tags">${tags}</div></article>`;
}

async function getJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`blog request failed: ${response.status}`);
  return response.json();
}

export async function initBlog() {
  const status = getElement("blog-status");
  const list = getElement("blog-list");
  const article = getElement("blog-article");
  if (!status || !list || !article) return;
  try {
    const slug = location.pathname.replace(/^\/blog\/?/, "");
    if (slug) {
      const post = await getJson(`/api/v1/blogs/${encodeURIComponent(slug)}`);
      document.title = `${post.title} · Eliware GlusterFS`;
      article.innerHTML = `<p class="blog-date">${formatDate(post.published_at)}</p><h1>${escapeHtml(post.title)}</h1><p class="lead">${escapeHtml(post.summary)}</p><p class="blog-byline">By ${escapeHtml(post.author)}</p><div class="blog-content">${post.html}</div><p><a href="/blog">← All posts</a></p>`;
      article.classList.remove("d-none");
      list.remove();
      status.remove();
      return;
    }
    const result = await getJson("/api/v1/blogs");
    list.innerHTML = result.posts.map(postCard).join("");
    status.textContent = result.total
      ? `${result.total} published post${result.total === 1 ? "" : "s"}`
      : "No posts published yet.";
  } catch {
    status.textContent = "Blog posts are temporarily unavailable.";
  }
}
