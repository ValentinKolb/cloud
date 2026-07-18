import type { AuthContext } from "@valentinkolb/cloud/server";
import { ssr } from "../../config";
import GridsHelpPage from "../_components/help/GridsHelpPage.island";
import { normalizeGridsHelpTopic } from "../_components/help/grids-help-routing";

export default ssr<AuthContext>((c) => {
  const initialTopic = normalizeGridsHelpTopic(c.req.param("topic") ?? c.req.query("topic"));
  c.get("page").title = "Grids help";
  return () => <GridsHelpPage initialTopic={initialTopic} />;
});
