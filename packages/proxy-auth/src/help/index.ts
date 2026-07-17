import { defineHelpCollection } from "@valentinkolb/cloud/server";
import start from "./documents/proxy-auth-start.help.md" with { type: "text" };

export const proxyAuthHelp = defineHelpCollection({
  basePath: "/api/proxy-auth/help",
  sources: [start],
});
