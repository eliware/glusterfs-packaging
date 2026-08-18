const SITE_URL = "https://glusterfs.eliware.org";

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function renderBlogRss(posts) {
  const items = posts
    .map(
      (post) => `<item>
      <title>${escapeXml(post.title)}</title>
      <link>${SITE_URL}/blog/${encodeURIComponent(post.slug)}</link>
      <guid isPermaLink="true">${SITE_URL}/blog/${encodeURIComponent(post.slug)}</guid>
      <description>${escapeXml(post.summary)}</description>
      <author>${escapeXml(post.author)}</author>
      <pubDate>${new Date(post.published_at).toUTCString()}</pubDate>
      ${post.tags.map((tag) => `<category>${escapeXml(tag)}</category>`).join("\n      ")}
    </item>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Eliware GlusterFS blog</title>
    <link>${SITE_URL}/blog</link>
    <description>News, guides, and release notes from Eliware GlusterFS.</description>
    <language>en</language>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml" />
    ${items}
  </channel>
</rss>
`;
}
