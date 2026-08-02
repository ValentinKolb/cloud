import { defineHelp } from "@valentinkolb/cloud/server";
import admin from "./documents/faq-admin.help.md" with { type: "text" };
import start from "./documents/faq-start.help.md" with { type: "text" };

export const faqHelp = defineHelp({
  documents: [start, admin],
});
