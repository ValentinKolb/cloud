import { defineHelpCollection } from "@valentinkolb/cloud/server";
import admin from "./documents/core-admin.help.md" with { type: "text" };
import profile from "./documents/core-profile.help.md" with { type: "text" };
import start from "./documents/core-start.help.md" with { type: "text" };

export const coreHelp = defineHelpCollection({
  basePath: "/api/core/help",
  sources: [start, profile, admin],
});
