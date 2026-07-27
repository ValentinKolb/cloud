import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createConfig } from "@k2b/ssr";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";

const root = mkdtempSync(resolve(tmpdir(), "cloud-status-badge-tests-"));
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
process.once("exit", () => rmSync(root, { recursive: true, force: true }));

const { default: StatusBadge } = await import("./StatusBadge");

test("running badges animate without overriding reduced-motion preferences", () => {
  const chip = renderToString(() => createComponent(StatusBadge, { tone: "running", label: "Running" }));
  const dot = renderToString(() => createComponent(StatusBadge, { tone: "running", label: "Running", variant: "dot" }));
  const failed = renderToString(() => createComponent(StatusBadge, { tone: "error", label: "Failed" }));

  expect(chip).toContain("ti-loader-2");
  expect(chip).toContain("motion-safe:animate-spin");
  expect(dot).toContain("motion-safe:animate-pulse");
  expect(failed).not.toContain("animate-");
});
