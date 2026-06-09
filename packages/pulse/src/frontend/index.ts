import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/server";
import page from "./page";
import basePage from "./[baseId]/page";
import queryReferencePage from "./[baseId]/query-reference/page";
import publicPage from "./public-page";

export default new Hono<AuthContext>()
  .get("/display/:token", ...publicPage)
  .get("/:baseId/dashboards/:dashboardId", auth.requireRole("user", auth.redirectToLogin), ...basePage)
  .get("/:baseId/sources/:sourceId", auth.requireRole("user", auth.redirectToLogin), ...basePage)
  .get("/:baseId/sources", auth.requireRole("user", auth.redirectToLogin), ...basePage)
  .get("/:baseId/query-reference", auth.requireRole("user", auth.redirectToLogin), ...queryReferencePage)
  .get("/:baseId/explorer", auth.requireRole("user", auth.redirectToLogin), ...basePage)
  .get("/:baseId/metric-explorer", auth.requireRole("user", auth.redirectToLogin), ...basePage)
  .get("/:baseId/activity/events", auth.requireRole("user", auth.redirectToLogin), ...basePage)
  .get("/:baseId/activity/states", auth.requireRole("user", auth.redirectToLogin), ...basePage)
  .get("/:baseId/activity/metrics", auth.requireRole("user", auth.redirectToLogin), ...basePage)
  .get("/:baseId/activity", auth.requireRole("user", auth.redirectToLogin), ...basePage)
  .get("/:baseId", auth.requireRole("user", auth.redirectToLogin), ...basePage)
  .get("/", auth.requireRole("user", auth.redirectToLogin), ...page);
