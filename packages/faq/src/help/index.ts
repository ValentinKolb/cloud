import { defineHelpCollection } from "@valentinkolb/cloud/server";
import start from "./documents/faq-start.help.md" with { type: "text" };

export const faqHelp = defineHelpCollection({
  basePath: "/api/faq/help",
  sources: [start],
});
