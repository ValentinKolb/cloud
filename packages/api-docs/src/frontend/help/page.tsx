import type { AuthContext } from "@valentinkolb/cloud/server";
import { ssr } from "../../config";
import { apiDocsHelp } from "../../help";
import ApiDocsHelpPage from "./ApiDocsHelpPage.island";

export default ssr<AuthContext>((c) => {
  const requested = c.req.param("topic");
  const initialTopic = apiDocsHelp.manifest.some((document) => document.id === requested) ? requested : undefined;
  c.get("page").title = "API Docs help";
  return () => <ApiDocsHelpPage documents={apiDocsHelp.manifest} initialTopic={initialTopic} />;
});
