import type { AuthContext } from "@valentinkolb/cloud/server";
import { getRuntimeContext } from "@valentinkolb/cloud/ssr";
import { ssr } from "../../config";
import CoreLayoutHelp from "../CoreLayoutHelp.island";

export default ssr<AuthContext>((c) => {
  const app = getRuntimeContext(c).apps.find((candidate) => candidate.id === c.req.param("appId"));
  const help = app?.help;
  if (!app || !help) {
    c.status(404);
    return () => <main class="p-8 text-sm text-dimmed">Help is not currently available.</main>;
  }

  const requested = c.req.param("topic");
  const initialTopic = help.documents.some((document) => document.id === requested) ? requested : undefined;
  c.get("page").title = `${app.name} help`;
  return () => <CoreLayoutHelp documents={help.documents} initialTopic={initialTopic} pageBase={help.pageBase} />;
});
