import { defineHelp } from "@valentinkolb/cloud/server";
import start from "./documents/ipa-hosts-start.help.md" with { type: "text" };
import troubleshoot from "./documents/ipa-hosts-troubleshooting.help.md" with { type: "text" };

export const ipaHostsHelp = defineHelp({
  documents: [start, troubleshoot],
});
