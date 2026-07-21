import type { AuthContext } from "@valentinkolb/cloud/server";
import { ssr } from "../../config";
import { notebookHelp } from "../../help";
import NotebookLayoutHelp from "../[id]/_components/help/NotebookLayoutHelp.island";

export default ssr<AuthContext>((c) => {
  const requested = c.req.param("topic");
  const initialTopic = notebookHelp.manifest.some((document) => document.id === requested) ? requested : undefined;
  c.get("page").title = "Notebooks help";
  return () => <NotebookLayoutHelp documents={notebookHelp.manifest} initialTopic={initialTopic} mode="page" />;
});
