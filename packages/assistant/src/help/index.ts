import { defineHelpCollection } from "@valentinkolb/cloud/server";
import guidance from "./documents/assistant-guidance.help.md" with { type: "text" };
import overview from "./documents/assistant-overview.help.md" with { type: "text" };
import workflow from "./documents/assistant-workflow.help.md" with { type: "text" };

export const assistantHelp = defineHelpCollection({
  basePath: "/api/assistant/help",
  sources: [overview, workflow, guidance],
});
