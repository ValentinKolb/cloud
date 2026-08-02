import { defineHelp } from "@valentinkolb/cloud/server";
import start from "./documents/files-start.help.md" with { type: "text" };
import troubleshoot from "./documents/files-troubleshooting.help.md" with { type: "text" };
import work from "./documents/files-work.help.md" with { type: "text" };

export const filesHelp = defineHelp({
  documents: [start, work, troubleshoot],
});
