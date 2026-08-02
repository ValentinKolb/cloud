import { defineHelp } from "@valentinkolb/cloud/server";
import admin from "./documents/core-admin.help.md" with { type: "text" };
import notifications from "./documents/core-notifications.help.md" with { type: "text" };
import profile from "./documents/core-profile.help.md" with { type: "text" };
import security from "./documents/core-security.help.md" with { type: "text" };
import start from "./documents/core-start.help.md" with { type: "text" };

export const coreHelp = defineHelp({
  documents: [start, profile, security, notifications, admin],
});
