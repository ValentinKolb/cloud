import type { AuthContext } from "@valentinkolb/cloud/server";
import { ssr } from "../../config";
import { oauthHelp } from "../../help";
import OAuthLayoutHelp from "../_components/OAuthLayoutHelp.island";

export default ssr<AuthContext>((c) => {
  const requested = c.req.param("topic");
  const initialTopic = oauthHelp.manifest.some((document) => document.id === requested) ? requested : undefined;
  c.get("page").title = "OAuth help";
  return () => <OAuthLayoutHelp documents={oauthHelp.manifest} initialTopic={initialTopic} mode="page" />;
});
