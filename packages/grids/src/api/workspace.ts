import { type AuthContext, auth, getDateConfig, v } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { z } from "zod";
import { loadGridsWorkspaceState } from "../frontend/_components/workspace/workspace-state";
import { SHORT_ID_REGEX } from "../service/short-id";
import { currentActorUser } from "./permissions";
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

const app = new Hono<AuthContext>()
  .use(auth.requireRole("authenticated"))
  .get("/route", v("query", z.object({ href: z.string().min(1).max(3000) })), async (c) => {
    const target = parseWorkspaceHref(c.req.valid("query").href);
    if (!target) return c.json({ message: "Unsupported workspace route" }, 400);
    const user = currentActorUser(c);
    if (!user) return c.json({ message: "Sign in to open this workspace." }, 403);
    const state = await loadGridsWorkspaceState({
      user,
      href: c.req.valid("query").href,
      dateConfig: await getDateConfig(c),
      ...target,
    });
    return c.json(await withInitialQueryPreview(c, state));
  });

export default app;
