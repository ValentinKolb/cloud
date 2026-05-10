import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/server";
import indexPage from "./page";
import baseDetailPage from "./[baseId]/page";
import baseSettingsPage from "./[baseId]/settings/page";
import tableRecordsPage from "./[baseId]/table/[tableId]/page";
import tableEditPage from "./[baseId]/table/[tableId]/edit/page";
import viewRecordsPage from "./[baseId]/table/[tableId]/view/[viewId]/page";
import viewEditPage from "./[baseId]/table/[tableId]/view/[viewId]/edit/page";
import dashboardRenderPage from "./[baseId]/dashboard/[dashboardId]/page";
import dashboardEditPage from "./[baseId]/dashboard/[dashboardId]/edit/page";
import adminPage from "./admin";
import publicFormPage from "./public/forms/[token]/page";

/** Admin pages mounted at `/admin/grids` — platform-admin only. */
export const adminRoutes = new Hono<AuthContext>().get(
  "/",
  auth.requireRole("admin", auth.redirectToLogin),
  ...adminPage,
);

/** Public pages mounted at `/public/grids` — anonymous-friendly. */
export const publicRoutes = new Hono<AuthContext>().get(
  "/forms/:token",
  auth.requireRole("*"),
  ...publicFormPage,
);

/**
 * Default export = user-facing app pages mounted at `/app/grids`.
 *
 * URL shape (path-based, mirrors notebooks). Routes are registered in
 * specificity order so Hono's matcher tries the longest path first:
 *
 *   /:base/table/:table/view/:view/edit  →  view editor
 *   /:base/table/:table/view/:view       →  records page scoped to view
 *   /:base/table/:table/edit             →  table editor
 *   /:base/table/:table                  →  records page
 *   /:base/dashboard/:dashboard/edit     →  dashboard editor
 *   /:base/dashboard/:dashboard          →  dashboard render
 *   /:base/settings                      →  base settings
 *   /:base                               →  base home (redirects)
 *
 * The records / view / dashboard render routes all share the SAME
 * default-export handler from [baseId]/page.tsx via re-export — the
 * handler reads `tableId` / `viewId` / `dashboardId` from c.req.param
 * and branches inside.
 */
export default new Hono<AuthContext>()
  .get("/", auth.requireRole("user", auth.redirectToLogin), ...indexPage)
  // View paths — most specific first (edit before render before plain).
  .get(
    "/:baseId/table/:tableId/view/:viewId/edit",
    auth.requireRole("user", auth.redirectToLogin),
    ...viewEditPage,
  )
  .get(
    "/:baseId/table/:tableId/view/:viewId",
    auth.requireRole("user", auth.redirectToLogin),
    ...viewRecordsPage,
  )
  // Table paths.
  .get(
    "/:baseId/table/:tableId/edit",
    auth.requireRole("user", auth.redirectToLogin),
    ...tableEditPage,
  )
  .get(
    "/:baseId/table/:tableId",
    auth.requireRole("user", auth.redirectToLogin),
    ...tableRecordsPage,
  )
  // Dashboard paths.
  .get(
    "/:baseId/dashboard/:dashboardId/edit",
    auth.requireRole("user", auth.redirectToLogin),
    ...dashboardEditPage,
  )
  .get(
    "/:baseId/dashboard/:dashboardId",
    auth.requireRole("user", auth.redirectToLogin),
    ...dashboardRenderPage,
  )
  .get("/:baseId/settings", auth.requireRole("user", auth.redirectToLogin), ...baseSettingsPage)
  .get("/:baseId", auth.requireRole("user", auth.redirectToLogin), ...baseDetailPage);
