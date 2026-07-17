import { defineHelpCollection } from "@valentinkolb/cloud/server";
import start from "./documents/tools-start.help.md" with { type: "text" };

export const toolsHelp = defineHelpCollection({
  basePath: "/tools/api/help",
  sources: [start],
});
