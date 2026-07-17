import type { AuthContext } from "@valentinkolb/cloud/server";
import { ssr } from "../../config";
import GridsHelpPage, { normalizeGridsHelpTopic } from "../_components/help/GridsHelpPage";

export default ssr<AuthContext>((c) => {
  const initialTopic = normalizeGridsHelpTopic(c.req.param("topic") ?? c.req.query("topic"));
  c.get("page").title = "Grids help";
  return () => <GridsHelpPage initialTopic={initialTopic} />;
});
