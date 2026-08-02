import { defineHelp } from "@valentinkolb/cloud/server";
import start from "./documents/api-docs-start.help.md" with { type: "text" };

export const apiDocsHelp = defineHelp({
  documents: [start],
});
