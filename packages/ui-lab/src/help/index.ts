import { defineHelpCollection } from "@valentinkolb/cloud/server";
import reference from "./documents/ui-lab-reference.help.md" with { type: "text" };
import start from "./documents/ui-lab-start.help.md" with { type: "text" };

export const uiLabHelp = defineHelpCollection({
  basePath: "/api/ui-lab/help",
  sources: [start, reference],
});
