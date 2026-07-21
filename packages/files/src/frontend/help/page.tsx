import type { AuthContext } from "@valentinkolb/cloud/server";
import { ssr } from "../../config";
import { filesHelp } from "../../help";
import FilesLayoutHelp from "../_components/help/FilesLayoutHelp.island";

export default ssr<AuthContext>((c) => {
  const requested = c.req.param("topic");
  const initialTopic = filesHelp.manifest.some((document) => document.id === requested) ? requested : undefined;
  c.get("page").title = "Files help";
  return () => <FilesLayoutHelp documents={filesHelp.manifest} initialTopic={initialTopic} mode="page" />;
});
