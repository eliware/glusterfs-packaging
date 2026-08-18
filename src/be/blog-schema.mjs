import { assertMetadataVersion } from "./metadata-version.mjs";

export const BLOG_SCHEMA = 1;
export const BLOG_STATUSES = ["draft", "published"];
export const BLOG_REQUIRED_FIELDS = [
  "metadata_version",
  "schema",
  "slug",
  "title",
  "summary",
  "published_at",
  "updated_at",
  "author",
  "tags",
  "status",
  "content",
];

const BLOG_FIELDS = new Set(BLOG_REQUIRED_FIELDS);
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function assertString(value, label) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} must be a non-empty string`);
}

function assertTimestamp(value, label) {
  assertString(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))
    throw new Error(`${label} must be an ISO-8601 UTC timestamp`);
  if (Number.isNaN(Date.parse(value))) throw new Error(`${label} is invalid`);
}

export function assertBlogDocument(value, label = "blog document") {
  assertMetadataVersion(value, label);
  for (const field of BLOG_REQUIRED_FIELDS)
    if (
      !Object.hasOwn(value, field) ||
      value[field] === null ||
      value[field] === ""
    )
      throw new Error(`${label} is missing required field: ${field}`);
  if (Object.hasOwn(value, "meta_version"))
    throw new Error(`${label} uses legacy meta_version`);
  if (value.schema !== BLOG_SCHEMA)
    throw new Error(
      `${label} schema ${String(value.schema)} is unsupported; expected ${BLOG_SCHEMA}`,
    );
  for (const field of Object.keys(value))
    if (!BLOG_FIELDS.has(field))
      throw new Error(`${label} has unsupported field: ${field}`);
  if (!SLUG_PATTERN.test(value.slug))
    throw new Error(
      `${label} slug must contain lowercase letters, numbers, and hyphens`,
    );
  assertString(value.title, `${label} title`);
  assertString(value.summary, `${label} summary`);
  assertTimestamp(value.published_at, `${label} published_at`);
  assertTimestamp(value.updated_at, `${label} updated_at`);
  if (Date.parse(value.updated_at) < Date.parse(value.published_at))
    throw new Error(`${label} updated_at cannot precede published_at`);
  assertString(value.author, `${label} author`);
  if (
    !Array.isArray(value.tags) ||
    value.tags.length === 0 ||
    value.tags.some((tag) => typeof tag !== "string" || !tag.trim())
  )
    throw new Error(`${label} tags must be a non-empty string array`);
  if (new Set(value.tags).size !== value.tags.length)
    throw new Error(`${label} tags must not contain duplicates`);
  if (!BLOG_STATUSES.includes(value.status))
    throw new Error(`${label} status must be draft or published`);
  assertString(value.content, `${label} content`);
  return value;
}
