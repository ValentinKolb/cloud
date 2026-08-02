import { defineHelp } from "@valentinkolb/cloud/server";
import admin from "./documents/accounts-admin.help.md" with { type: "text" };
import cli from "./documents/accounts-cli.help.md" with { type: "text" };
import lifecycle from "./documents/accounts-lifecycle.help.md" with { type: "text" };
import start from "./documents/accounts-start.help.md" with { type: "text" };

export const accountsHelp = defineHelp({
  documents: [start, admin, lifecycle, cli],
});
