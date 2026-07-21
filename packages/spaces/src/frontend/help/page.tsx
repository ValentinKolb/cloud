import type { AuthContext } from "@valentinkolb/cloud/server";
import { ssr } from "../../config";
import { spacesHelp } from "../../help";
import SpacesLayoutHelp from "../_components/help/SpacesLayoutHelp.island";

export default ssr<AuthContext>((c) => {
  const requested = c.req.param("topic");
  const initialTopic = spacesHelp.manifest.some((document) => document.id === requested) ? requested : undefined;
  c.get("page").title = "Spaces help";
  return () => <SpacesLayoutHelp documents={spacesHelp.manifest} initialTopic={initialTopic} mode="page" />;
});
