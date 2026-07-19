import { defineHelpCollection } from "@valentinkolb/cloud/server";
import integrate from "./documents/oauth-integration.help.md" with { type: "text" };
import start from "./documents/oauth-start.help.md" with { type: "text" };
import troubleshoot from "./documents/oauth-troubleshooting.help.md" with { type: "text" };

export const oauthHelp = defineHelpCollection({
  basePath: "/api/oauth/help",
  sources: [start, integrate, troubleshoot],
});
