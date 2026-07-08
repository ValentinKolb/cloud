import { type AuthContext, auth, getDateConfig, v } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { z } from "zod";
import { loadGridsWorkspaceState } from "../frontend/_components/workspace/workspace-state";
import { currentActorUser } from "./permissions";
import { withInitialQueryPreview } from "./workspace-query-preview";

export const parseWorkspaceHref = (href: string) => {
  const url = new URL(href, "http://grids.local");
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "app" || parts[1] !== "grids" || !parts[2]) return null;
  const baseShortId = parts[2];
  if (parts.length === 3) {
    return {
      baseShortId,
      activeTableSlug: null,
      activeViewSlug: null,
      activeDashboardSlug: null,
      activeDocumentTableSlug: null,
      activeDocumentTemplateSlug: null,
    };
  }
  if (parts.length === 4 && parts[3] === "query") {
    return {
      baseShortId,
      activeTableSlug: null,
      activeViewSlug: null,
      activeDashboardSlug: null,
      activeDocumentTableSlug: null,
      activeDocumentTemplateSlug: null,
    };
  }
  if (parts.length === 6 && parts[3] === "table" && parts[5] === "query") {
    return {
      baseShortId,
      activeTableSlug: parts[4],
      activeViewSlug: null,
      activeDashboardSlug: null,
      activeDocumentTableSlug: null,
      activeDocumentTemplateSlug: null,
    };
  }
  if (parts.length === 8 && parts[3] === "table" && parts[5] === "view" && parts[7] === "query") {
    return {
      baseShortId,
      activeTableSlug: parts[4],
      activeViewSlug: parts[6],
      activeDashboardSlug: null,
      activeDocumentTableSlug: null,
      activeDocumentTemplateSlug: null,
    };
  }
  if (parts.length === 4 && parts[3] === "automations") {
    return {
      baseShortId,
      activeTableSlug: null,
      activeViewSlug: null,
      activeDashboardSlug: null,
      activeDocumentTableSlug: null,
      activeDocumentTemplateSlug: null,
    };
  }
  if (parts.length === 5 && parts[3] === "dashboard") {
    return {
      baseShortId,
      activeTableSlug: null,
      activeViewSlug: null,
      activeDashboardSlug: parts[4],
      activeDocumentTableSlug: null,
      activeDocumentTemplateSlug: null,
    };
  }
  if (parts.length === 4 && parts[3] === "workflows") {
    return {
      baseShortId,
      activeTableSlug: null,
      activeViewSlug: null,
      activeDashboardSlug: null,
      activeWorkflowSlug: null,
      activeDocumentTableSlug: null,
      activeDocumentTemplateSlug: null,
    };
  }
  if (parts.length === 5 && parts[3] === "workflows") {
    return {
      baseShortId,
      activeTableSlug: null,
      activeViewSlug: null,
      activeDashboardSlug: null,
      activeWorkflowSlug: parts[4],
      activeDocumentTableSlug: null,
      activeDocumentTemplateSlug: null,
    };
  }
  if (parts.length === 6 && parts[3] === "document") {
    return {
      baseShortId,
      activeTableSlug: null,
      activeViewSlug: null,
      activeDashboardSlug: null,
      activeDocumentTableSlug: parts[4],
      activeDocumentTemplateSlug: parts[5],
    };
  }
  if (parts.length === 5 && parts[3] === "table") {
    return {
      baseShortId,
      activeTableSlug: parts[4],
      activeViewSlug: null,
      activeDashboardSlug: null,
      activeDocumentTableSlug: null,
      activeDocumentTemplateSlug: null,
    };
  }
  if (parts.length === 7 && parts[3] === "table" && parts[5] === "view") {
    return {
      baseShortId,
      activeTableSlug: parts[4],
      activeViewSlug: parts[6],
      activeDashboardSlug: null,
      activeDocumentTableSlug: null,
      activeDocumentTemplateSlug: null,
    };
  }
  return null;
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
