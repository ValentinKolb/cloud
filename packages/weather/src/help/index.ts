import { defineHelpCollection } from "@valentinkolb/cloud/server";
import read from "./documents/weather-read.help.md" with { type: "text" };
import start from "./documents/weather-start.help.md" with { type: "text" };
import troubleshoot from "./documents/weather-troubleshooting.help.md" with { type: "text" };

export const weatherHelp = defineHelpCollection({
  basePath: "/api/weather/help",
  sources: [start, read, troubleshoot],
});
