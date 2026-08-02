import { defineHelp } from "@valentinkolb/cloud/server";
import start from "./documents/venue-start.help.md" with { type: "text" };
import troubleshoot from "./documents/venue-troubleshooting.help.md" with { type: "text" };
import work from "./documents/venue-work.help.md" with { type: "text" };

export const venueHelp = defineHelp({
  documents: [start, work, troubleshoot],
});
