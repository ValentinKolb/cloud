import { defineHelpCollection } from "@valentinkolb/cloud/server";
import start from "./documents/venue-start.help.md" with { type: "text" };
import work from "./documents/venue-work.help.md" with { type: "text" };

export const venueHelp = defineHelpCollection({
  basePath: "/api/venue/help",
  sources: [start, work],
});
