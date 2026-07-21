import type { AuthContext } from "@valentinkolb/cloud/server";
import { ssr } from "../../config";
import { pulseHelp } from "../../help";
import PulseLayoutHelp from "../PulseLayoutHelp.island";

export default ssr<AuthContext>((c) => {
  const requested = c.req.param("topic");
  const initialTopic = pulseHelp.manifest.some((document) => document.id === requested) ? requested : undefined;
  c.get("page").title = "Pulse help";
  return () => <PulseLayoutHelp documents={pulseHelp.manifest} initialTopic={initialTopic} mode="page" />;
});
