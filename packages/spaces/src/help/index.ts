import { defineHelpCollection } from "@valentinkolb/cloud/server";
import sharing from "./documents/spaces-sharing.help.md" with { type: "text" };
import start from "./documents/spaces-start.help.md" with { type: "text" };
import troubleshoot from "./documents/spaces-troubleshooting.help.md" with { type: "text" };
import views from "./documents/spaces-views.help.md" with { type: "text" };
import workflow from "./documents/spaces-workflow.help.md" with { type: "text" };

export const spacesHelp = defineHelpCollection({
  basePath: "/api/spaces/help",
  sources: [start, views, workflow, sharing, troubleshoot],
});
