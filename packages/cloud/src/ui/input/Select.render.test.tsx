import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createConfig } from "@k2b/ssr";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";

const root = mkdtempSync(resolve(tmpdir(), "cloud-select-tests-"));
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
process.once("exit", () => rmSync(root, { recursive: true, force: true }));

const { Select } = await import("./Select");

test("colored options keep their label and render a decorative color marker", () => {
  const html = renderToString(() =>
    createComponent(Select, {
      label: "Tag",
      value: () => "priority",
      options: [{ id: "priority", label: "Priority", color: "#2563eb" }],
    }),
  );

  expect(html).toContain("Priority");
  expect(html).toContain("background-color:#2563eb");
  expect(html).toContain('aria-hidden="true"');
});

test("compact selects expose an explicit accessible name and descriptive icon options", () => {
  const html = renderToString(() =>
    createComponent(Select, {
      ariaLabel: "Match conditions",
      value: () => "all",
      options: [
        {
          id: "all",
          label: "Match all",
          icon: "ti ti-list-check",
          description: "Run only when every condition matches.",
        },
        {
          id: "any",
          label: "Match any",
          icon: "ti ti-list-details",
          description: "Run when at least one condition matches.",
        },
      ],
    }),
  );

  expect(html).toContain('aria-label="Match conditions"');
  expect(html).toContain('aria-label="Match conditions options"');
  expect(html).toContain("ti ti-list-check");
  expect(html).toContain("Run only when every condition matches.");
  expect(html).toContain("Run when at least one condition matches.");
});
