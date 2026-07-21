import type { AuthContext } from "@valentinkolb/cloud/server";
import { ssr } from "../../config";
import { contactsHelp } from "../../help";
import ContactsLayoutHelp from "../_components/help/ContactsLayoutHelp.island";

export default ssr<AuthContext>((c) => {
  const requested = c.req.param("topic");
  const initialTopic = contactsHelp.manifest.some((document) => document.id === requested) ? requested : undefined;
  c.get("page").title = "Contacts help";
  return () => <ContactsLayoutHelp documents={contactsHelp.manifest} initialTopic={initialTopic} mode="page" />;
});
