import { defineHelpCollection } from "@valentinkolb/cloud/server";
import start from "./documents/files-start.help.md" with { type: "text" };
import work from "./documents/files-work.help.md" with { type: "text" };

export const filesHelp = defineHelpCollection({
  basePath: "/api/files/help",
  sources: [start, work],
});
