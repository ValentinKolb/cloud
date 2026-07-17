import { defineHelpCollection } from "@valentinkolb/cloud/server";
import start from "./documents/oauth-start.help.md" with { type: "text" };

export const oauthHelp = defineHelpCollection({
  basePath: "/api/oauth/help",
  sources: [start],
});
