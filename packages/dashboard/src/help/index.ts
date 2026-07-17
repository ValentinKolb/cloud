import { defineHelpCollection } from "@valentinkolb/cloud/server";
import start from "./documents/dashboard-start.help.md" with { type: "text" };

export const dashboardHelp = defineHelpCollection({
  basePath: "/api/dashboard/help",
  sources: [start],
});
