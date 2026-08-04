import { describe, expect, test } from "bun:test";

const source = await Bun.file(new URL("./McpSetup.island.tsx", import.meta.url)).text();

describe("Developer MCP setup", () => {
  test("documents both supported client setup paths without embedding a credential", () => {
    expect(source).toContain("CLOUD_API_KEY");
    expect(source).toContain("oauth_resource");
    expect(source).toContain("claude mcp add --transport http");
    expect(source).toContain("<personal-api-key>");
    expect(source).not.toContain("cld_");
  });
});
