import type { AuthContext } from "@valentinkolb/cloud/server";
import { ssr } from "../../config";
import { gatewayOpsHelp } from "../../help";
import GatewayOpsLayoutHelp from "../GatewayOpsLayoutHelp.island";

export default ssr<AuthContext>((c) => {
  const requested = c.req.param("topic");
  const initialTopic = gatewayOpsHelp.manifest.some((document) => document.id === requested) ? requested : undefined;
  c.get("page").title = "Gateway help";
  return () => <GatewayOpsLayoutHelp documents={gatewayOpsHelp.manifest} initialTopic={initialTopic} mode="page" />;
});
