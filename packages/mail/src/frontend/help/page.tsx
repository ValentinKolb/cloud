import type { AuthContext } from "@valentinkolb/cloud/server";
import { ssr } from "../../config";
import { mailHelp } from "../../help";
import MailLayoutHelp from "../_components/help/MailLayoutHelp.island";

export default ssr<AuthContext>((c) => {
  const requested = c.req.param("topic");
  const initialTopic = mailHelp.manifest.some((document) => document.id === requested) ? requested : undefined;
  c.get("page").title = "Mail help";
  return () => <MailLayoutHelp documents={mailHelp.manifest} initialTopic={initialTopic} mode="page" />;
});
