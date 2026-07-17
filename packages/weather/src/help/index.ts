import { defineHelpCollection } from "@valentinkolb/cloud/server";
import start from "./documents/weather-start.help.md" with { type: "text" };

export const weatherHelp = defineHelpCollection({
  basePath: "/api/weather/help",
  sources: [start],
});
