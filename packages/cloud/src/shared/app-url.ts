/** Resolve the configured public Cloud URL to one canonical origin. */
export const publicCloudOrigin = (value: string): string => {
  const raw = value.trim().replace(/\/+$/, "");
  const configured = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  const local = configured.hostname === "localhost" || configured.hostname === "127.0.0.1" || configured.hostname === "::1";
  return new URL(/^https?:\/\//i.test(raw) || !local ? configured : `http://${raw}`).origin;
};

export const CLOUD_MCP_PATH = "/api/mcp/v1";

/** Resolve the canonical OAuth resource URI for Cloud's built-in MCP server. */
export const cloudMcpResourceUri = (appUrl: string): string => `${publicCloudOrigin(appUrl)}${CLOUD_MCP_PATH}`;
