import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../../..");
const read = (path: string) => Bun.file(join(repoRoot, path)).text();

const helpRoutes = [
  ["packages/accounts/src/frontend/index.ts", "/help"],
  ["packages/api-docs/src/frontend/index.ts", "/help"],
  ["packages/assistant/src/frontend/index.ts", "/help"],
  ["packages/contacts/src/frontend/index.ts", "/help"],
  ["packages/core/src/pages/create.tsx", "/help"],
  ["packages/dashboard/src/index.ts", "/help"],
  ["packages/faq/src/frontend/index.ts", "/help"],
  ["packages/files/src/frontend/index.ts", "/help"],
  ["packages/gateway-ops/src/index.ts", "/admin/gateway/help"],
  ["packages/ipa-hosts/src/frontend/index.ts", "/help"],
  ["packages/mail/src/frontend/index.ts", "/help"],
  ["packages/notebooks/src/frontend/index.ts", "/help"],
  ["packages/oauth/src/frontend/index.ts", "/admin/oauth/help"],
  ["packages/proxy-auth/src/frontend/index.ts", "/help"],
  ["packages/pulse/src/frontend/index.ts", "/help"],
  ["packages/spaces/src/frontend/index.ts", "/help"],
  ["packages/tools/src/frontend/index.ts", "/help"],
  ["packages/ui-lab/src/frontend/index.ts", "/help"],
  ["packages/venue/src/frontend/index.ts", "/help"],
  ["packages/weather/src/frontend/index.ts", "/help"],
] as const;

describe("standalone Layout Help routes", () => {
  test("every legacy Help-enabled app owns a hub and topic SSR route", async () => {
    const missing: string[] = [];
    for (const [path, route] of helpRoutes) {
      const source = await read(path);
      if (!source.includes(`.get("${route}"`) || !source.includes(`.get("${route}/:topic"`)) missing.push(path);
    }
    expect(missing).toEqual([]);
  });

  test("registered Help leaves Grids routing to the framework", async () => {
    const [entry, definition, routes] = await Promise.all([
      read("packages/grids/src/index.ts"),
      read("packages/grids/src/help/index.ts"),
      read("packages/grids/src/frontend/index.ts"),
    ]);

    expect(entry).toContain("help: gridsHelp");
    expect(definition).toMatch(/\bdefineHelp\s*\(/);
    expect(routes).not.toContain('.get("/help"');
    expect(routes).not.toContain('.get("/help/:topic"');
  });

  test("Core owns the registered Help reader", async () => {
    const routes = await read("packages/core/src/pages/create.tsx");
    expect(routes).toContain('.get("/help/apps/:appId"');
    expect(routes).toContain('.get("/help/apps/:appId/:topic"');
  });

  test("registered Grids Help owns its declaration and Markdown below src/help", async () => {
    const markdownPaths: string[] = [];
    for await (const path of new Bun.Glob("packages/grids/src/**/*.help.md").scan({ cwd: repoRoot })) markdownPaths.push(path);

    expect(await Bun.file(join(repoRoot, "packages/grids/src/help/index.ts")).exists()).toBe(true);
    expect(markdownPaths.length).toBeGreaterThan(0);
    expect(markdownPaths.every((path) => path.startsWith("packages/grids/src/help/"))).toBe(true);
  });

  test("the retired query-overlay strategy cannot return", async () => {
    const legacyReferences: string[] = [];
    for await (const path of new Bun.Glob("packages/*/src/**/*.{ts,tsx,md}").scan({ cwd: repoRoot })) {
      if (path.endsWith("LayoutHelp.routes.test.ts")) continue;
      const source = await read(path);
      if (source.includes("LayoutHelpBrowserPage") || source.includes("?help=") || source.includes("HELP_PAGE_PARAM")) {
        legacyReferences.push(path);
      }
    }
    expect(legacyReferences).toEqual([]);
  });
});
