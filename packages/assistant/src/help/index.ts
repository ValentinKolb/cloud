import { defineHelp } from "@valentinkolb/cloud/server";
import guidance from "./documents/assistant-guidance.help.md" with { type: "text" };
import overview from "./documents/assistant-overview.help.md" with { type: "text" };
import workflow from "./documents/assistant-workflow.help.md" with { type: "text" };

export const assistantHelp = defineHelp({
  documents: [overview, workflow, guidance],
});
