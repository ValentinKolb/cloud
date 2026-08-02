import { defineHelp } from "@valentinkolb/cloud/server";
import admin from "./documents/mail-admin.help.md" with { type: "text" };
import automation from "./documents/mail-automation.help.md" with { type: "text" };
import collaboration from "./documents/mail-collaboration.help.md" with { type: "text" };
import compose from "./documents/mail-compose.help.md" with { type: "text" };
import start from "./documents/mail-start.help.md" with { type: "text" };
import troubleshooting from "./documents/mail-troubleshooting.help.md" with { type: "text" };
import work from "./documents/mail-work.help.md" with { type: "text" };
import workflows from "./documents/mail-workflows.help.md" with { type: "text" };

export const mailHelp = defineHelp({
  documents: [start, work, compose, collaboration, admin, automation, workflows, troubleshooting],
});
