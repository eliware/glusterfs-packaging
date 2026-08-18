# Blog document format

Blog posts are persistent public metadata documents. They follow the same
metadata policy as catalog, release, checkpoint, and provenance documents:

- Every document has `metadata_version` equal to the root `package.json`
  version.
- Every document has an explicit numeric `schema` field.
- Missing required values are errors; readers do not infer or substitute them.
- The legacy `meta_version` field is rejected.
- Unknown fields are rejected so the public contract cannot drift silently.
- Blog format changes use the ordered migration process documented in
  `docs/METADATA.md`.

## Canonical schema

Each JSON file under the shared publication volume's `blogs/` directory is one
document with this shape:

```json
{
  "metadata_version": "<package.json version>",
  "schema": 1,
  "slug": "rolling-releases",
  "title": "Following rolling releases",
  "summary": "How to follow GlusterFS rolling builds.",
  "published_at": "2026-08-18T12:00:00Z",
  "updated_at": "2026-08-18T12:00:00Z",
  "author": "Eliware",
  "tags": ["releases", "rolling"],
  "status": "published",
  "content": "# Rolling releases\n\nMarkdown content goes here."
}
```

Field rules:

- `slug` is unique and contains only lowercase letters, numbers, and hyphens.
- `title`, `summary`, `author`, and `content` are non-empty strings.
- `published_at` and `updated_at` are UTC ISO-8601 timestamps ending in `Z`.
- `updated_at` must not precede `published_at`.
- `tags` is a non-empty array of unique strings.
- `status` is either `draft` or `published`; drafts are never shown publicly
  or included in RSS.
- Canonical URLs are derived from `slug`; they are not duplicated in the
  document and therefore cannot become inconsistent.

Validation is implemented by `scripts/blog-schema.mjs` and covered by
`tests/blog-schema.test.mjs`. The HTTP loader, API, article pages, and RSS
generator all validate through the same store before exposing a document.

## Published routes

- `/blog` lists published posts.
- `/blog/<slug>` serves an individual article page.
- `/api/v1/blogs` returns the published post collection.
- `/api/v1/blogs/<slug>` returns one published post and safe rendered HTML.
- `/feed.xml` returns the RSS 2.0 feed.

The HTTP image contains the blog viewer and schema code. At runtime it reads
JSON posts from the shared publication volume, so adding or editing a post does
not require rebuilding the image. Draft files are excluded from public pages,
APIs, RSS, and the sitemap.
