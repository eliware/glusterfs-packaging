import crypto from "node:crypto";

export const IMAGE_REPOSITORY = "ghcr.io/eliware/centos10-gluster";

export function shortDigest(digest) {
  const value = String(digest || "").replace(/^sha256:/, "");
  return value.slice(0, 8) || "unknown";
}

export function stableImageTags(version, baseDigest) {
  const exact = `${version}-cs10-${shortDigest(baseDigest)}`;
  return { exact, aliases: [version, "latest"] };
}

export function rollingImageTags(date, sourceCommit, baseDigest) {
  const exact = `${date}-${String(sourceCommit).slice(0, 12)}-cs10-${shortDigest(baseDigest)}`;
  return { exact, aliases: ["rolling"] };
}

export function imageReference(tag, repository = IMAGE_REPOSITORY) {
  return `${repository}:${tag}`;
}

export function imageNames(tags) {
  return [tags.exact, ...tags.aliases].map((tag) => imageReference(tag));
}

export function sourceFingerprint({
  sourceRef,
  sourceCommit,
  baseDigest,
  rpmMetadataSha256,
}) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        sourceRef,
        sourceCommit,
        baseDigest,
        rpmMetadataSha256,
      }),
    )
    .digest("hex");
}
