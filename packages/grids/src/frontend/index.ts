import { type AuthContext, auth } from "@valentinkolb/cloud/server";
import type { Context } from "hono";
import { Hono } from "hono";
import { pdfResponse } from "../api/download-response";
import { gridsService } from "../service";
import dashboardRenderPage from "./[baseId]/dashboard/[dashboardId]/page";
import documentTemplatePage from "./[baseId]/document/[documentTableId]/[documentTemplateId]/page";
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

const auditRequestContext = (c: Context<AuthContext>) => ({
  ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("cf-connecting-ip") || null,
  userAgent: c.req.header("user-agent") ?? null,
});

/** Public pages mounted at `/share/grids` — anonymous-friendly. */
export const publicRoutes = new Hono<AuthContext>()
  .get("/forms/:token", auth.requireRole("*"), ...publicFormPage)
  .get("/documents/:token", auth.requireRole("*"), async (c) => {
    const requestAudit = auditRequestContext(c);
    const resolved = await gridsService.document.resolveDocumentLinkDownload(c.req.param("token") ?? "");
    if (!resolved.ok) return c.json({ message: "Document link not found" }, 404);
    const pdf = await gridsService.document.renderRunPdf(resolved.data.run);
    if (!pdf.ok) return c.json({ message: pdf.error.message }, pdf.error.status);
    const access = await gridsService.document.recordDocumentLinkAccess(resolved.data.link.id, requestAudit);
    if (!access.ok) return c.json({ message: "Document link not found" }, 404);
    return pdfResponse(pdf.data.pdf, resolved.data.run.filename, {
      "X-Grids-Document-Run-Id": resolved.data.run.id,
      "X-Grids-Document-Link-Id": resolved.data.link.id,
    });
  });

/**
 * Default export = user-facing app pages mounted at `/app/grids`.
 *
 * URL shape (path-based, mirrors notebooks). Routes are registered in
 * specificity order so Hono's matcher tries the longest path first:
 *
 *   /:base/table/:table/view/:view       → records page scoped to view
 *   /:base/table/:table                  → table records page
 *   /:base/document/:table/:template     → document template workspace
 *   /:base/dashboard/:dashboard          → dashboard render page
 *   /:base/reference/...                 → reference window
 *   /:base/query                         → GQL query explorer
 *   /:base/workflows[/workflow]          → workflow overview/detail
 *   /:base                               → workspace shell/default redirect
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
  // Document template paths.
  .get("/:baseId/document/:documentTableId/:documentTemplateId", auth.requireRole("user", auth.redirectToLogin), ...documentTemplatePage)
  // Dashboard paths.
  .get("/:baseId/dashboard/:dashboardId", auth.requireRole("user", auth.redirectToLogin), ...dashboardRenderPage)
  .get("/:baseId/reference/tables/:sourceId", auth.requireRole("user", auth.redirectToLogin), ...queryReferencePage)
  .get("/:baseId/reference/:tab", auth.requireRole("user", auth.redirectToLogin), ...queryReferencePage)
  .get("/:baseId/reference", auth.requireRole("user", auth.redirectToLogin), ...queryReferencePage)
  .get("/:baseId/query-reference", auth.requireRole("user", auth.redirectToLogin), ...queryReferencePage)
  .get("/:baseId/query", auth.requireRole("user", auth.redirectToLogin), ...queryWorkspacePage)
  .get("/:baseId/workflows/:workflowId", auth.requireRole("user", auth.redirectToLogin), ...baseDetailPage)
  .get("/:baseId/workflows", auth.requireRole("user", auth.redirectToLogin), ...baseDetailPage)
  .get("/:baseId", auth.requireRole("user", auth.redirectToLogin), ...baseDetailPage);
