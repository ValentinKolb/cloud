import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { shippedStyleFiles } from "./css-contract-test-helpers";

const stylesDir = import.meta.dir;
const styleSources = shippedStyleFiles(stylesDir).map((file) => ({
  file,
  source: readFileSync(resolve(stylesDir, file), "utf8"),
}));
const shippedCss = styleSources.map(({ source }) => source).join("\n");

describe("@k2b/ui stylesheet hygiene", () => {
  test("does not restore selectors and tokens proven dead during migration", () => {
    const removed = [
      "k2b-button--secondary",
      "k2b-switch__content",
      "k2b-app-overview__panel-content",
      "data-k2b-tone",
      "k2b-progress-indeterminate",
      "k2b-pagination__edge",
      ".k2b-markdown ",
      ".k2b-structured-data ",
      ".k2b-calendar__",
      ".k2b-file-view ",
      "--k2b-control-height",
      "--k2b-font-condensed",
      "--k2b-danger:",
    ];

    for (const token of removed) expect(shippedCss, token).not.toContain(token);
  });

  test("keeps every declared keyframe reachable and media blocks non-empty", () => {
    const names = [...shippedCss.matchAll(/@(?:-webkit-)?keyframes\s+([\w-]+)/g)].map((match) => match[1]!);
    const unused = names.filter((name) => shippedCss.match(new RegExp(`\\b${name}\\b`, "g"))?.length === 1);
    const emptyMedia = styleSources
      .filter(({ source }) => /@media[^{}]*\{\s*\}/s.test(source.replace(/\/\*[\s\S]*?\*\//g, "")))
      .map(({ file }) => file);

    expect(names.length).toBeGreaterThan(0);
    expect(unused).toEqual([]);
    expect(emptyMedia).toEqual([]);
  });

  test("keeps portal, motion and semantic status fixes explicit", () => {
    const index = readFileSync(resolve(stylesDir, "index.css"), "utf8");
    const surfaces = readFileSync(resolve(stylesDir, "surfaces-widgets-parity.css"), "utf8");
    const plex = readFileSync(resolve(stylesDir, "../fonts/plex.css"), "utf8");

    expect(index).toMatch(/\.k2b-ui \.k2b-ui-portal\s*\{\s*display:\s*contents;\s*\}/);
    expect(index).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.k2b-ui \.k2b-switch__thumb,[\s\S]*?sidebar-mobile details > summary > i[\s\S]*?transition:\s*none;/,
    );
    expect(surfaces).toMatch(
      /\.k2b-status-badge\[data-tone="degraded"\] \.k2b-status-badge__dot\s*\{\s*background:\s*var\(--k2b-warning-500\);/,
    );
    expect(surfaces).toContain(
      '.k2b-ui .k2b-notice-card[data-tone="info"] { border-color: color-mix(in srgb, var(--k2b-accent-500) 42%, var(--k2b-border)); color: var(--k2b-info-text); background: var(--k2b-info-surface); }',
    );
    expect(surfaces).toContain(
      '.k2b-ui .k2b-notice-card[data-tone="success"] { border-color: color-mix(in srgb, var(--k2b-success-500) 42%, var(--k2b-border)); color: var(--k2b-success-text); background: var(--k2b-success-surface); }',
    );
    expect(plex).not.toContain("ibm-plex-sans-condensed");
  });

  test("keeps normalization scoped without owning a global base layer", () => {
    const index = readFileSync(resolve(stylesDir, "index.css"), "utf8");

    expect(index).toContain("@layer theme, base, components, utilities;");
    expect(index).not.toContain("@layer base {");
    expect(index).toMatch(
      /\.k2b-ui,\s*\.k2b-ui \*,\s*\.k2b-ui \*::before,\s*\.k2b-ui \*::after \{\s*box-sizing: border-box;[\s\S]*?\.k2b-ui :where\(button, input, select, textarea\) \{\s*font: inherit;/,
    );
  });
});
