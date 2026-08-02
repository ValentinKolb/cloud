import { defineHelp } from "@valentinkolb/cloud/server";
import start from "./documents/dashboard-start.help.md" with { type: "text" };
import troubleshoot from "./documents/dashboard-troubleshooting.help.md" with { type: "text" };

export const dashboardHelp = defineHelp({
  documents: [start, troubleshoot],
});
