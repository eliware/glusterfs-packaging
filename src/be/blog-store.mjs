import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { assertBlogDocument } from "./blog-schema.mjs";

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    error.message = `${label}: ${error.message}`;
    throw error;
  }
}

async function readBlogs(blogDir) {
  let names;
  try {
    names = await readdir(blogDir);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const documents = [];
  for (const name of names.filter((item) => item.endsWith(".json")).sort()) {
    const file = path.join(blogDir, name);
    documents.push(
      assertBlogDocument(parseJson(await readFile(file, "utf8"), file), file),
    );
  }
  const slugs = new Set();
  for (const document of documents) {
    if (slugs.has(document.slug))
      throw new Error(`duplicate blog slug: ${document.slug}`);
    slugs.add(document.slug);
  }
  return documents.sort(
    (left, right) =>
      Date.parse(right.published_at) - Date.parse(left.published_at) ||
      left.slug.localeCompare(right.slug),
  );
}

export async function loadBlogs(blogDir) {
  return readBlogs(blogDir);
}

export function createBlogStore(blogDir) {
  let cached = [];
  let cachedSignature = "";
  return {
    async all() {
      let signature = "";
      try {
        const names = (await readdir(blogDir))
          .filter((name) => name.endsWith(".json"))
          .sort();
        const files = await Promise.all(
          names.map(async (name) => {
            const details = await stat(path.join(blogDir, name));
            return `${name}:${details.size}:${details.mtimeMs}`;
          }),
        );
        signature = files.join("|");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (signature !== cachedSignature) {
        cached = await readBlogs(blogDir);
        cachedSignature = signature;
      }
      return cached;
    },
    async published() {
      return (await this.all()).filter((blog) => blog.status === "published");
    },
    async bySlug(slug) {
      return (
        (await this.published()).find((blog) => blog.slug === slug) || null
      );
    },
  };
}
