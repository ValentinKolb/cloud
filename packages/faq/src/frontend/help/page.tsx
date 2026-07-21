import type { AuthContext } from "@valentinkolb/cloud/server";
import { ssr } from "../../config";
import { faqHelp } from "../../help";
import FaqLayoutHelp from "../_components/help/FaqLayoutHelp.island";

export default ssr<AuthContext>((c) => {
  const requested = c.req.param("topic");
  const initialTopic = faqHelp.manifest.some((document) => document.id === requested) ? requested : undefined;
  c.get("page").title = "FAQ help";
  return () => <FaqLayoutHelp documents={faqHelp.manifest} initialTopic={initialTopic} mode="page" />;
});
