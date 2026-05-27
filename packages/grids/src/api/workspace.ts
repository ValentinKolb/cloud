import { Hono } from "hono";
import { z } from "zod";
import { auth, type AuthContext, v } from "@valentinkolb/cloud/server";
import { loadGridsWorkspaceState } from "../frontend/_components/workspace/workspace-state";

const parseWorkspaceHref = (href: string) => {
  const url = new URL(href, "http://grids.local");
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "app" || parts[1] !== "grids" || !parts[2]) return null;
  const baseShortId = parts[2];
  if (parts.length === 3) return { baseShortId, settings: false, activeTableSlug: null, activeViewSlug: null, activeDashboardSlug: null };
  if (parts.length === 4 && parts[3] === "settings") {
    return { baseShortId, settings: true, activeTableSlug: null, activeViewSlug: null, activeDashboardSlug: null };
  }
  if (parts.length === 5 && parts[3] === "dashboard") {
    return { baseShortId, settings: false, activeTableSlug: null, activeViewSlug: null, activeDashboardSlug: parts[4] };
  }
  if (parts.length === 5 && parts[3] === "table") {
    return { baseShortId, settings: false, activeTableSlug: parts[4], activeViewSlug: null, activeDashboardSlug: null };
  }
  if (parts.length === 7 && parts[3] === "table" && parts[5] === "view") {
    return { baseShortId, settings: false, activeTableSlug: parts[4], activeViewSlug: parts[6], activeDashboardSlug: null };
  }
  return null;
};

const app = new Hono<AuthContext>()
  .use(auth.requireRole("authenticated"))
  .get(
    "/route",
    v("query", z.object({ href: z.string().min(1).max(3000) })),
    async (c) => {
      const target = parseWorkspaceHref(c.req.valid("query").href);
      if (!target) return c.json({ message: "Unsupported workspace route" }, 400);
      const state = await loadGridsWorkspaceState({
        user: c.get("user"),
        href: c.req.valid("query").href,
        ...target,
      });
      return c.json(state);
    },
  );

export default app;

