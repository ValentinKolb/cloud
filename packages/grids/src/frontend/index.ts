import { type AuthContext, auth } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import dashboardRenderPage from "./[baseId]/dashboard/[dashboardId]/page";
import baseDetailPage from "./[baseId]/page";
import queryWorkspacePage from "./[baseId]/query/page";
import queryReferencePage from "./[baseId]/query-reference/page";
import formulaReferencePage from "./[baseId]/table/[tableId]/formula-reference/page";
import tableRecordsPage from "./[baseId]/table/[tableId]/page";
import viewRecordsPage from "./[baseId]/table/[tableId]/view/[viewId]/page";
import adminPage from "./admin";
import indexPage from "./page";
import publicFormPage from "./public/forms/[token]/page";

/** Admin pages mounted at `/admin/grids` — platform-admin only. */
export const adminRoutes = new Hono<AuthContext>().get("/", auth.requireRole("admin", auth.redirectToLogin), ...adminPage);

/** Public pages mounted at `/public/grids` — anonymous-friendly. */
export const publicRoutes = new Hono<AuthContext>().get("/forms/:token", auth.requireRole("*"), ...publicFormPage);

/**
 * Default export = user-facing app pages mounted at `/app/grids`.
 *
 * URL shape (path-based, mirrors notebooks). Routes are registered in
 * specificity order so Hono's matcher tries the longest path first:
 *
 *   /:base/table/:table/view/:view       →  records page scoped to view
 *   /:base/table/:table                  →  records page
 *   /:base/dashboard/:dashboard          →  dashboard render
 *   /:base                               →  base home (redirects)
 *
 * The records / view / dashboard render routes all share the SAME
 * default-export handler from [baseId]/page.tsx via re-export — the
 * handler reads `tableId` / `viewId` / `dashboardId` from c.req.param
 * and branches inside.
 */
export default new Hono<AuthContext>()
  .get("/", auth.requireRole("user", auth.redirectToLogin), ...indexPage)
  // Old edit URLs redirect to the canonical in-context edit mode.
  .get("/:baseId/table/:tableId/view/:viewId/edit", auth.requireRole("user", auth.redirectToLogin), (c) =>
    c.redirect(`/app/grids/${c.req.param("baseId")}/table/${c.req.param("tableId")}/view/${c.req.param("viewId")}?edit=true`, 302),
  )
  .get("/:baseId/table/:tableId/edit", auth.requireRole("user", auth.redirectToLogin), (c) =>
    c.redirect(`/app/grids/${c.req.param("baseId")}/table/${c.req.param("tableId")}?edit=true`, 302),
  )
  .get("/:baseId/dashboard/:dashboardId/edit", auth.requireRole("user", auth.redirectToLogin), (c) =>
    c.redirect(`/app/grids/${c.req.param("baseId")}/dashboard/${c.req.param("dashboardId")}?edit=true`, 302),
  )
  // View paths.
  .get("/:baseId/table/:tableId/view/:viewId/query", auth.requireRole("user", auth.redirectToLogin), ...baseDetailPage)
  .get("/:baseId/table/:tableId/view/:viewId", auth.requireRole("user", auth.redirectToLogin), ...viewRecordsPage)
  .get("/:baseId/table/:tableId/formula-reference", auth.requireRole("user", auth.redirectToLogin), ...formulaReferencePage)
  // Table paths.
  .get("/:baseId/table/:tableId/query", auth.requireRole("user", auth.redirectToLogin), ...baseDetailPage)
  .get("/:baseId/table/:tableId", auth.requireRole("user", auth.redirectToLogin), ...tableRecordsPage)
  // Dashboard paths.
  .get("/:baseId/dashboard/:dashboardId", auth.requireRole("user", auth.redirectToLogin), ...dashboardRenderPage)
  .get("/:baseId/reference/tables/:sourceId", auth.requireRole("user", auth.redirectToLogin), ...queryReferencePage)
  .get("/:baseId/reference/:tab", auth.requireRole("user", auth.redirectToLogin), ...queryReferencePage)
  .get("/:baseId/reference", auth.requireRole("user", auth.redirectToLogin), ...queryReferencePage)
  .get("/:baseId/query-reference", auth.requireRole("user", auth.redirectToLogin), ...queryReferencePage)
  .get("/:baseId/query/:queryId", auth.requireRole("user", auth.redirectToLogin), ...queryWorkspacePage)
  .get("/:baseId/query", auth.requireRole("user", auth.redirectToLogin), ...queryWorkspacePage)
  .get("/:baseId/automations", auth.requireRole("user", auth.redirectToLogin), ...baseDetailPage)
  .get("/:baseId", auth.requireRole("user", auth.redirectToLogin), ...baseDetailPage);
