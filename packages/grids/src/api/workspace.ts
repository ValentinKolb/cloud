import { type AuthContext, auth, getDateConfig, v } from "@valentinkolb/cloud/server";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { loadGridsWorkspaceState } from "../frontend/_components/workspace/workspace-state";
import { gridsService } from "../service";
import { SHORT_ID_REGEX } from "../service/short-id";
import { currentActorUser, gateAt } from "./permissions";
import { withInitialQueryPreview } from "./workspace-query-preview";

type WorkspaceRouteTarget = {
  baseShortId: string;
  activeTableSlug: string | null;
  activeViewSlug: string | null;
  activeDashboardSlug: string | null;
  activeWorkflowSlug: string | null;
  activeDocumentTableSlug: string | null;
  activeDocumentTemplateSlug: string | null;
};

const workspaceTarget = (baseShortId: string, overrides: Partial<WorkspaceRouteTarget> = {}): WorkspaceRouteTarget => ({
  baseShortId,
  activeTableSlug: null,
  activeViewSlug: null,
  activeDashboardSlug: null,
  activeWorkflowSlug: null,
  activeDocumentTableSlug: null,
  activeDocumentTemplateSlug: null,
  ...overrides,
});

const parseTableRoute = (baseShortId: string, parts: string[]): WorkspaceRouteTarget | null => {
  const tableSlug = parts[4];
  if (!tableSlug) return null;
  const suffix = parts.slice(5).join("/");
  const viewMatch = suffix.match(/^view\/([^/]+)(?:\/query)?$/);

  if (suffix === "" || suffix === "query") return workspaceTarget(baseShortId, { activeTableSlug: tableSlug });
  return viewMatch ? workspaceTarget(baseShortId, { activeTableSlug: tableSlug, activeViewSlug: viewMatch[1] ?? null }) : null;
};

const routeParsers: Record<string, (baseShortId: string, parts: string[]) => WorkspaceRouteTarget | null> = {
  query: (baseShortId, parts) => (parts.length === 4 ? workspaceTarget(baseShortId) : null),
  dashboard: (baseShortId, parts) => (parts.length === 5 ? workspaceTarget(baseShortId, { activeDashboardSlug: parts[4] }) : null),
  workflows: (baseShortId, parts) => {
    if (parts.length === 4) return workspaceTarget(baseShortId);
    return parts.length === 5 ? workspaceTarget(baseShortId, { activeWorkflowSlug: parts[4] }) : null;
  },
  document: (baseShortId, parts) =>
    parts.length === 6
      ? workspaceTarget(baseShortId, {
          activeDocumentTableSlug: parts[4],
          activeDocumentTemplateSlug: parts[5],
        })
      : null,
  table: parseTableRoute,
};

export const parseWorkspaceHref = (href: string): WorkspaceRouteTarget | null => {
  const url = new URL(href, "http://grids.local");
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "app" || parts[1] !== "grids" || !parts[2]) return null;
  const baseShortId = parts[2];
  if (!SHORT_ID_REGEX.test(baseShortId)) return null;

  if (parts.length === 3) return workspaceTarget(baseShortId);
  return routeParsers[parts[3] ?? ""]?.(baseShortId, parts) ?? null;
};

export const createWorkspaceApi = (
  deps: {
    requireAuthenticated?: MiddlewareHandler<AuthContext>;
    getBaseByShortId?: typeof gridsService.base.getByShortId;
    gate?: typeof gateAt;
    loadState?: typeof loadGridsWorkspaceState;
    withPreview?: typeof withInitialQueryPreview;
  } = {},
) => {
  const getBaseByShortId = deps.getBaseByShortId ?? gridsService.base.getByShortId;
  const gateAtTarget = deps.gate ?? gateAt;
  const loadState = deps.loadState ?? loadGridsWorkspaceState;
  const withPreview = deps.withPreview ?? withInitialQueryPreview;

  return new Hono<AuthContext>()
    .use(deps.requireAuthenticated ?? auth.requireRole("authenticated"))
    .get("/route", v("query", z.object({ href: z.string().min(1).max(3000) })), async (c) => {
      const target = parseWorkspaceHref(c.req.valid("query").href);
      if (!target) return c.json({ message: "Unsupported workspace route" }, 400);
      const base = await getBaseByShortId(target.baseShortId);
      if (!base) return c.json({ message: "Base not found" }, 404);
      const gate = await gateAtTarget(c, { baseId: base.id }, "read");
      if (!gate.ok) return c.json({ message: "Base not found" }, 404);
      const user = currentActorUser(c);
      if (!user) return c.json({ message: "Sign in to open this workspace." }, 403);
      const state = await loadState({
        user,
        href: c.req.valid("query").href,
        dateConfig: await getDateConfig(c),
        ...target,
      });
      return c.json(await withPreview(c, state));
    });
};

export default createWorkspaceApi();
