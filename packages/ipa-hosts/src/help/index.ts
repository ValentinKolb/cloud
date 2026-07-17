import { defineHelpCollection } from "@valentinkolb/cloud/server";
import start from "./documents/ipa-hosts-start.help.md" with { type: "text" };

export const ipaHostsHelp = defineHelpCollection({
  basePath: "/api/ipa-hosts/help",
  sources: [start],
});
