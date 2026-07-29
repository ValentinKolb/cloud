import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createConfig } from "@k2b/ssr";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";

const pluginRoot = mkdtempSync(resolve(tmpdir(), "k2b-ui-fixture-render-"));
const { plugin } = createConfig({ dev: true, rootDir: pluginRoot });
Bun.plugin(plugin());
process.once("exit", () => rmSync(pluginRoot, { recursive: true, force: true }));

const { default: StandaloneUi } = await import("./src/StandaloneUi");

const packageRoot = resolve(import.meta.dir, "..");
const stylesPath = resolve(packageRoot, "dist/styles.css");

if (!existsSync(stylesPath)) {
  throw new Error("dist/styles.css is missing — run `bun run build` before rendering the fixture");
}

const styleSources = readdirSync(resolve(packageRoot, "src/styles"))
  .filter((name) => name.endsWith(".css"))
  .map((name) => resolve(packageRoot, "src/styles", name));
const builtAt = statSync(stylesPath).mtimeMs;
const staleSource = styleSources.find((file) => statSync(file).mtimeMs > builtAt);
if (staleSource) {
  throw new Error(`dist/styles.css predates ${staleSource} — run \`bun run build\` before tests`);
}

const styles = readFileSync(stylesPath, "utf8");
const externalClass = (token: string) =>
  token === "ti" ||
  token.startsWith("ti-") ||
  token.startsWith("cd-") ||
  token.startsWith("md-") ||
  token.startsWith("stdlib-") ||
  /^(?:is|has)-/.test(token);
const hookClass = new Set(["k2b-copy-button", "k2b-toast-container"]);
const hasRule = (token: string) =>
  new RegExp(`\\.${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(styles);
const renderedClasses = (html: string): string[] => {
  const tokens = new Set<string>();
  for (const match of html.matchAll(/class="([^"]*)"/g)) {
    for (const token of match[1]!.split(/\s+/)) if (token) tokens.add(token);
  }
  return [...tokens];
};

describe("@k2b/ui standalone fixture", () => {
  test("renders every catalog family through the public package boundary", () => {
    const html = renderToString(() => createComponent(StandaloneUi, {}));

    for (const marker of [
      "k2b-text-input",
      "k2b-choice-control",
      "k2b-stat-grid",
      "k2b-calendar",
      "k2b-data-table",
      "k2b-content-code-display",
      "k2b-content-file-tree",
      "k2b-chat-message",
      "k2b-widget",
    ]) {
      expect(html).toContain(marker);
    }
  });

  test("renders no package class missing from the shipped stylesheet", () => {
    const html = renderToString(() => createComponent(StandaloneUi, {}));
    const unstyled = renderedClasses(html).filter(
      (token) => !externalClass(token) && !hookClass.has(token) && !hasRule(token),
    );

    expect(unstyled).toEqual([]);
  });
});
