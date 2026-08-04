import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { carryForwardSsrAssets } from "../src/build-output";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("keeps missing SSR assets for already-open pages without overwriting the new build", async () => {
  const root = await mkdtemp(join(tmpdir(), "cloud-docs-build-"));
  temporaryRoots.push(root);
  const previousDist = join(root, "previous");
  const nextDist = join(root, "next");
  await mkdir(join(previousDist, "_ssr"), { recursive: true });
  await mkdir(join(nextDist, "_ssr"), { recursive: true });

  await Bun.write(join(previousDist, "_ssr", "chunk-old.js"), "export const generation = 'old';");
  await Bun.write(join(previousDist, "_ssr", "chunk-current.js"), "export const generation = 'old';");
  await Bun.write(join(previousDist, "_ssr", "ignored.txt"), "not a runtime asset");
  await Bun.write(join(nextDist, "_ssr", "chunk-current.js"), "export const generation = 'new';");

  await carryForwardSsrAssets(previousDist, nextDist);

  expect(await Bun.file(join(nextDist, "_ssr", "chunk-old.js")).text()).toContain("'old'");
  expect(await Bun.file(join(nextDist, "_ssr", "chunk-current.js")).text()).toContain("'new'");
  expect(await Bun.file(join(nextDist, "_ssr", "ignored.txt")).exists()).toBe(false);
});
