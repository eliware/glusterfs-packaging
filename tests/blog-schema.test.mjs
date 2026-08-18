import { assertBlogDocument } from "../scripts/blog-schema.mjs";
import { METADATA_VERSION } from "../scripts/metadata-version.mjs";

const validBlog = {
  metadata_version: METADATA_VERSION,
  schema: 1,
  slug: "rolling-releases",
  title: "Following rolling releases",
  summary: "How to follow GlusterFS rolling builds.",
  published_at: "2026-08-18T12:00:00Z",
  updated_at: "2026-08-18T12:00:00Z",
  author: "Eliware",
  tags: ["releases", "rolling"],
  status: "published",
  content: "# Rolling releases\n\nContent.",
};

test("accepts the canonical blog document shape", () => {
  expect(assertBlogDocument(validBlog)).toEqual(validBlog);
});

test("rejects missing metadata version and legacy metadata names", () => {
  const missing = { ...validBlog };
  delete missing.metadata_version;
  expect(() => assertBlogDocument(missing)).toThrow(/metadata version/);

  expect(() =>
    assertBlogDocument({ ...validBlog, meta_version: "0.1.0" }),
  ).toThrow(/legacy meta_version/);
});

test("rejects unsupported fields and schemas", () => {
  expect(() => assertBlogDocument({ ...validBlog, schema: 2 })).toThrow(
    /schema 2/,
  );
  expect(() =>
    assertBlogDocument({ ...validBlog, internal_note: "secret" }),
  ).toThrow(/unsupported field/);
});

test("rejects invalid publication metadata", () => {
  expect(() =>
    assertBlogDocument({ ...validBlog, slug: "Not A Slug" }),
  ).toThrow(/slug/);
  expect(() =>
    assertBlogDocument({ ...validBlog, updated_at: "2026-08-17T12:00:00Z" }),
  ).toThrow(/updated_at/);
  expect(() =>
    assertBlogDocument({ ...validBlog, tags: ["releases", "releases"] }),
  ).toThrow(/duplicates/);
});
