import type { AuthContext } from "@valentinkolb/cloud/server";
import { ssr } from "../../config";
import { toolsHelp } from "../../help";
import ToolsLayoutHelp from "../_components/help/ToolsLayoutHelp.island";

export default ssr<AuthContext>((c) => {
  const requested = c.req.param("topic");
  const initialTopic = toolsHelp.manifest.some((document) => document.id === requested) ? requested : undefined;
  c.get("page").title = "Tools help";
  return () => <ToolsLayoutHelp documents={toolsHelp.manifest} initialTopic={initialTopic} mode="page" />;
});
