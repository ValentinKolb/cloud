import { defineHelpCollection } from "@valentinkolb/cloud/server";
import start from "./documents/api-docs-start.help.md" with { type: "text" };

export const apiDocsHelp = defineHelpCollection({
  basePath: "/api/api-docs/help",
  sources: [start],
});
