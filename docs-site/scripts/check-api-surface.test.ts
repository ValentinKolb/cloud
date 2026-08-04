import { expect, test } from "bun:test";
import { documentedPackageSpecifiers, packageSpecifier, undocumentedExports, unguidedSpecializedEntryPoints } from "./check-api-surface";

test("maps and checks package export specifiers", () => {
  expect(packageSpecifier("@scope/pkg", ".")).toBe("@scope/pkg");
  expect(packageSpecifier("@scope/pkg", "./server")).toBe("@scope/pkg/server");
  expect(
    undocumentedExports(
      "@scope/pkg",
      { ".": "./index.ts", "./server": "./server.ts" },
      "| `@scope/pkg` | Supported | Root |\nUse `@scope/pkg/server` in prose.",
    ),
  ).toEqual(["@scope/pkg/server"]);
  expect(documentedPackageSpecifiers("@scope/pkg", "| `@scope/pkg` | Supported | Root |")).toEqual(new Set(["@scope/pkg"]));
});

test("requires a guide for app-facing specialized entry points", () => {
  const reference = `
## Specialized entry points

| Entry point | Status | Use | Guide |
| --- | --- | --- | --- |
| \`@scope/pkg/browser\` | Supported, browser | Browser client | [Browser guide](/en/docs/browser) |
| \`@scope/pkg/server\` | Supported, server-only | Server client | — |
| \`@scope/pkg/internal\` | Platform-owned | Internal client | — |

## Next section
`;

  expect(unguidedSpecializedEntryPoints(reference)).toEqual(["@scope/pkg/server"]);
});
