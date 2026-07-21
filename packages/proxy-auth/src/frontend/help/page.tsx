import type { AuthContext } from "@valentinkolb/cloud/server";
import { ssr } from "../../config";
import { proxyAuthHelp } from "../../help";
import ProxyAuthLayoutHelp from "../ProxyAuthLayoutHelp.island";

export default ssr<AuthContext>((c) => {
  const requested = c.req.param("topic");
  const initialTopic = proxyAuthHelp.manifest.some((document) => document.id === requested) ? requested : undefined;
  c.get("page").title = "Proxy Auth help";
  return () => <ProxyAuthLayoutHelp documents={proxyAuthHelp.manifest} initialTopic={initialTopic} mode="page" />;
});
