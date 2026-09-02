import path from "node:path";

export function packagePublicationRelativePath({
  packageFormat,
  distribution,
  suite,
  channel = "stable",
  candidate,
}) {
  if (!packageFormat) throw new Error("package format is required");
  if (!distribution) throw new Error("package distribution is required");
  if (channel === "preview" && !candidate)
    throw new Error("preview candidate is required");
  const suffix = channel === "preview" ? ["previews", candidate] : ["stable"];
  if (packageFormat === "rpm") return path.posix.join("el10", "x86_64", ...suffix);
  if (packageFormat === "deb" && suite)
    return path.posix.join(distribution, suite, "amd64", ...suffix);
  throw new Error(
    `unsupported package publication: ${packageFormat}/${distribution}`,
  );
}

export function publicationRelativePath(reference) {
  if (!reference) throw new Error("publication path is required");
  const value = /^https?:\/\//i.test(reference)
    ? new URL(reference).pathname
    : reference;
  const relative = value.replace(/^\/+/, "");
  let decoded;
  try {
    decoded = decodeURIComponent(relative);
  } catch {
    throw new Error(`invalid publication path: ${reference}`);
  }
  const segments = decoded.replaceAll("\\", "/").split("/");
  if (!relative || segments.some((segment) => segment === ".." || segment === ".") || decoded.includes("\\"))
    throw new Error(`invalid publication path: ${reference}`);
  return decoded;
}

export function publicationFile(root, reference) {
  return path.join(root, publicationRelativePath(reference));
}
