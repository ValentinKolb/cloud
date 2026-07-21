import type { AuthContext } from "@valentinkolb/cloud/server";
import { ssr } from "../../config";
import { assistantHelp } from "../../help";
import AssistantLayoutHelp from "../AssistantLayoutHelp.island";

export default ssr<AuthContext>((c) => {
  const requested = c.req.param("topic");
  const initialTopic = assistantHelp.manifest.some((document) => document.id === requested) ? requested : undefined;
  c.get("page").title = "Assistant help";
  return () => <AssistantLayoutHelp documents={assistantHelp.manifest} initialTopic={initialTopic} mode="page" />;
});
