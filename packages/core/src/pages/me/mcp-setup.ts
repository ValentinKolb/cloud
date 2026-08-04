export type McpSetupSnippets = {
  endpoint: string;
  codexApiKey: string;
  codexOAuth: string;
  claudeApiKey: string;
  claudeOAuth: string;
};

export const createMcpSetupSnippets = (endpoint: string): McpSetupSnippets => ({
  endpoint,
  codexApiKey: `codex mcp add cloud --url ${endpoint} --bearer-token-env-var CLOUD_API_KEY`,
  codexOAuth: `codex mcp add cloud --url ${endpoint} --oauth-client-id <client-id> --oauth-resource ${endpoint}\ncodex mcp login cloud --scopes read,write`,
  claudeApiKey: `claude mcp add --transport http --scope user cloud ${endpoint} --header "Authorization: Bearer $CLOUD_API_KEY"`,
  claudeOAuth: `claude mcp add --transport http --scope user --client-id <client-id> --callback-port <registered-port> cloud ${endpoint}`,
});
