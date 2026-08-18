import { expect, test } from "@jest/globals";
import {
  imageNames,
  rollingImageTags,
  stableImageTags,
} from "../scripts/image-identifiers.mjs";

test("stable tags include the Gluster version and CentOS base identity", () => {
  const tags = stableImageTags("11.2", "sha256:b7f85bb8be4c");
  expect(tags.exact).toBe("11.2-cs10-b7f85bb8");
  expect(tags.aliases).toEqual(["11.2", "latest"]);
});

test("rolling tags include date, source commit, and CentOS base identity", () => {
  const tags = rollingImageTags(
    "2026.08.15",
    "abcdef1234567890",
    "sha256:b7f85bb8",
  );
  expect(tags.exact).toBe("2026.08.15-abcdef123456-cs10-b7f85bb8");
  expect(imageNames(tags)).toEqual([
    "ghcr.io/eliware/centos10-gluster:2026.08.15-abcdef123456-cs10-b7f85bb8",
    "ghcr.io/eliware/centos10-gluster:rolling",
  ]);
});
