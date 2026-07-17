import { defineHelpCollection } from "@valentinkolb/cloud/server";
import books from "./documents/contacts-books-sharing.help.md" with { type: "text" };
import hierarchy from "./documents/contacts-hierarchy.help.md" with { type: "text" };
import start from "./documents/contacts-start.help.md" with { type: "text" };

export const contactsHelp = defineHelpCollection({
  basePath: "/api/contacts/help",
  sources: [start, hierarchy, books],
});
