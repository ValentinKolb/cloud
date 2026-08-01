import { describe, expect, test } from "bun:test";

const compose = await Bun.file(new URL("../compose.prod.yml", import.meta.url)).text();

describe("production Compose release set", () => {
  test("requires one immutable tag for every runtime image", () => {
    const images = compose
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("image: ghcr.io/valentinkolb/cloud-"));
    expect(images).toHaveLength(21);
    expect(images.every((line) => line.endsWith(":${CLOUD_IMAGE_TAG:?CLOUD_IMAGE_TAG is required}"))).toBeTrue();
    expect(images.some((line) => /:(?:latest|main)$/.test(line))).toBeFalse();
  });
});
