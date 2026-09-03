import { collectCatalogImages } from "../scripts/audit-ghcr-catalog.mjs";

test("collects GHCR references from nested catalog metadata", () => {
  const images = collectCatalogImages({
    image: { reference: "ghcr.io/eliware/alma10-gluster:11.2" },
    nested: [{ reference: "ghcr.io/eliware/ubuntu24-gluster:stable" }],
  });
  expect([...images].sort()).toEqual([
    "ghcr.io/eliware/alma10-gluster:11.2",
    "ghcr.io/eliware/ubuntu24-gluster:stable",
  ]);
});

test("ignores non-GHCR references and duplicates", () => {
  const images = collectCatalogImages({
    a: { reference: "docker.io/library/ubuntu:24.04" },
    b: { reference: "ghcr.io/eliware/alma10-gluster:11.2" },
    c: { reference: "ghcr.io/eliware/alma10-gluster:11.2" },
  });
  expect([...images]).toEqual(["ghcr.io/eliware/alma10-gluster:11.2"]);
});
