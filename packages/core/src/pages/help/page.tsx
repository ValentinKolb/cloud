import type { AuthContext } from "@valentinkolb/cloud/server";
import { ssr } from "../../config";
import { coreHelp } from "../../help";
import CoreLayoutHelp from "../CoreLayoutHelp.island";

export default ssr<AuthContext>((c) => {
  const requested = c.req.param("topic");
  const initialTopic = coreHelp.manifest.some((document) => document.id === requested) ? requested : undefined;
  c.get("page").title = "Cloud help";
  return () => <CoreLayoutHelp documents={coreHelp.manifest} initialTopic={initialTopic} mode="page" />;
});
