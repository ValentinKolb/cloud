import { defineHelpCollection } from "@valentinkolb/cloud/server";
import choose from "./documents/tools-choose.help.md" with { type: "text" };
import start from "./documents/tools-start.help.md" with { type: "text" };
import safety from "./documents/tools-safety.help.md" with { type: "text" };

export const toolsHelp = defineHelpCollection({
  basePath: "/tools/api/help",
  sources: [start, choose, safety],
});
