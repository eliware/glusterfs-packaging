const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/i;

export const DEFAULT_BASE_IMAGES = Object.freeze({
  centos: "quay.io/centos/centos:stream10",
  rocky: "rockylinux/rockylinux:10",
  alma: "almalinux:10",
  oracle: "oraclelinux:10",
  debian: "debian:12-slim",
  ubuntu: "ubuntu:24.04",
});

export function assertFloatingBaseImageReferences(baseImages) {
  if (!baseImages || typeof baseImages !== "object" || Array.isArray(baseImages))
    throw new Error("base image references must be an object");
  for (const [name, reference] of Object.entries(baseImages)) {
    if (typeof reference !== "string" || !reference.trim())
      throw new Error(`base image ${name} must have a tag reference`);
    if (reference.includes("@"))
      throw new Error(
        `base image ${name} must use a moving tag without a digest pin: ${reference}`,
      );
  }
}

export async function resolveBaseImageDigests(
  baseImages,
  { run, retryUpstream, dockerAuthFile, isDockerHubReference },
) {
  assertFloatingBaseImageReferences(baseImages);
  const digests = {};
  for (const [name, reference] of Object.entries(baseImages)) {
    digests[name] = await retryUpstream(`Base image ${name} (${reference})`, async () => {
      try {
        const inspectArgs = ["inspect"];
        const authFile = dockerAuthFile();
        if (isDockerHubReference(reference) && authFile) inspectArgs.push("--authfile", authFile);
        inspectArgs.push("--format", "{{.Digest}}", `docker://${reference}`);
        const digest = (
          await run("skopeo", inspectArgs, {
            capture: true,
            timeout: 30000,
          })
        ).stdout.trim();
        if (SHA256_DIGEST.test(digest)) return digest;
      } catch {}
      const manifest = JSON.parse(
        (
          await run(
            "docker",
            ["buildx", "imagetools", "inspect", "--format", "{{json .Manifest}}", reference],
            { capture: true, timeout: 30000 },
          )
        ).stdout,
      );
      if (SHA256_DIGEST.test(manifest.digest)) return manifest.digest;
      throw new Error(`registry returned no image digest for ${reference}`);
    }).catch((error) => {
      throw new Error(`could not resolve current base-image tag: ${reference}`, {
        cause: error,
      });
    });
  }
  return digests;
}
