import path from "node:path";

export function publicationRelativePath(reference) {
  if (!reference) throw new Error("publication path is required");
  const value = /^https?:\/\//i.test(reference)
    ? new URL(reference).pathname
    : reference;
  const relative = value.replace(/^\/+/, "");
  if (!relative || relative.split("/").includes(".."))
    throw new Error(`invalid publication path: ${reference}`);
  return relative;
}

export function publicationFile(root, reference) {
  return path.join(root, publicationRelativePath(reference));
}
