import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../../..");
const read = (path: string) => Bun.file(join(repoRoot, path)).text();

const registeredHelpApps = [
  "accounts",
  "api-docs",
  "assistant",
  "contacts",
  "core",
  "dashboard",
  "faq",
  "files",
  "gateway-ops",
  "grids",
  "ipa-hosts",
  "mail",
  "notebooks",
  "proxy-auth",
  "pulse",
  "spaces",
  "tools",
  "venue",
  "weather",
] as const;

describe("registered Layout Help routes", () => {
  test("every supported Help provider declares and registers Help once", async () => {
    const invalid: string[] = [];
    for (const appId of registeredHelpApps) {
      const [entry, definition] = await Promise.all([read(`packages/${appId}/src/index.ts`), read(`packages/${appId}/src/help/index.ts`)]);
      if (!entry.match(/\bhelp:\s*\w+Help\b/) || !definition.match(/\bdefineHelp\s*\(/) || definition.includes("defineHelpCollection")) {
        invalid.push(appId);
      }
    }
    expect(invalid).toEqual([]);
  });

  test("supported providers leave APIs, pages, and Layout registration to Cloud", async () => {
    const legacyReferences: string[] = [];
    for (const appId of registeredHelpApps) {
      for await (const path of new Bun.Glob(`packages/${appId}/src/**/*.{ts,tsx}`).scan({ cwd: repoRoot })) {
        const source = await read(path);
        if (
          source.includes("defineHelpCollection") ||
          /\w+Help\.router\b/.test(source) ||
          /import helpPage from [^;]*help\/page/.test(source) ||
          /<\w+LayoutHelp documents=\{\w+Help\.manifest\}/.test(source)
        ) {
          legacyReferences.push(path);
        }
      }
    }
    expect(legacyReferences).toEqual([]);
  });

  test("Core owns the registered Help reader", async () => {
    const routes = await read("packages/core/src/pages/create.tsx");
    expect(routes).toContain('.get("/help/apps/:appId"');
    expect(routes).toContain('.get("/help/apps/:appId/:topic"');
  });

  test("registered providers own their Markdown below src/help", async () => {
    for (const appId of registeredHelpApps) {
      const markdownPaths: string[] = [];
      for await (const path of new Bun.Glob(`packages/${appId}/src/**/*.help.md`).scan({ cwd: repoRoot })) markdownPaths.push(path);
      expect(await Bun.file(join(repoRoot, `packages/${appId}/src/help/index.ts`)).exists()).toBe(true);
      expect(markdownPaths.length, appId).toBeGreaterThan(0);
      expect(
        markdownPaths.every((path) => path.startsWith(`packages/${appId}/src/help/`)),
        appId,
      ).toBe(true);
    }
  });

  test("keeps deliberate OAuth and deprecated UI Lab exceptions explicit", async () => {
    expect(await Bun.file(join(repoRoot, "packages/oauth/src/help/index.ts")).exists()).toBe(false);
    expect(await read("packages/oauth/src/index.ts")).not.toMatch(/oauthHelp|\/api\/oauth\/help/);
    expect(await read("packages/oauth/src/frontend/index.ts")).not.toContain("/admin/oauth/help");

    expect(await read("packages/ui-lab/src/help/index.ts")).toContain("defineHelpCollection");
    expect(await read("packages/ui-lab/src/frontend/index.ts")).toContain('.get("/help"');
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
