import { describe, expect, test } from "bun:test";
import { createMcpSetupSnippets } from "./mcp-setup";

describe("Developer MCP setup", () => {
  test("builds exact API-key and URL-only browser-login setup commands", () => {
    expect(createMcpSetupSnippets("https://cloud.example/api/mcp/v1")).toEqual({
      endpoint: "https://cloud.example/api/mcp/v1",
      codexApiKey: "codex mcp add cloud --url https://cloud.example/api/mcp/v1 --bearer-token-env-var CLOUD_API_KEY",
      codexOAuth: "codex mcp add cloud --url https://cloud.example/api/mcp/v1\ncodex mcp login cloud --scopes read,write,offline_access",
      claudeApiKey:
        'claude mcp add --transport http --scope user cloud https://cloud.example/api/mcp/v1 --header "Authorization: Bearer $CLOUD_API_KEY"',
      claudeOAuth: "claude mcp add --transport http --scope user cloud https://cloud.example/api/mcp/v1\nclaude mcp login cloud",
    });
  });
});
