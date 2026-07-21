import type { AuthContext } from "@valentinkolb/cloud/server";
import { ssr } from "../../config";
import { dashboardHelp } from "../../help";
import DashboardLayoutHelp from "../_components/help/DashboardLayoutHelp.island";

export default ssr<AuthContext>((c) => {
  const requested = c.req.param("topic");
  const initialTopic = dashboardHelp.manifest.some((document) => document.id === requested) ? requested : undefined;
  c.get("page").title = "Dashboard help";
  return () => <DashboardLayoutHelp documents={dashboardHelp.manifest} initialTopic={initialTopic} mode="page" />;
});
