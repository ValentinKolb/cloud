import type { AuthContext } from "@valentinkolb/cloud/server";
import { ssr } from "../../config";
import { uiLabHelp } from "../../help";
import UiLabHelpPage from "./UiLabHelpPage.island";

export default ssr<AuthContext>((c) => {
  const requested = c.req.param("topic");
  const initialTopic = uiLabHelp.manifest.some((document) => document.id === requested) ? requested : undefined;
  c.get("page").title = "UI Lab help";
  return () => <UiLabHelpPage documents={uiLabHelp.manifest} initialTopic={initialTopic} />;
});
