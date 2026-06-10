import { type AuthContext, auth, respond, v } from "@valentinkolb/cloud/server";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { dashboardSettingsService } from "../service";
import { normalizeDashboardShortcutHref } from "../shared";

const safeLinkHref = (href: string): boolean => /^(\/|https?:\/\/|mailto:)/i.test(href);

const ShortcutSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string().min(1),
    kind: z.literal("app"),
    appId: z.string().min(1),
    title: z.string().trim().min(1).optional(),
    icon: z.string().trim().min(1).optional(),
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal("link"),
    href: z.string().trim().min(1).max(2_000).transform(normalizeDashboardShortcutHref).refine(safeLinkHref, "Use a relative, HTTP(S), or mailto link."),
    title: z.string().trim().min(1).max(80),
    icon: z.string().trim().min(1).max(120),
  }),
]);

const SettingsSchema = z.object({
  hiddenWidgets: z.array(z.string().min(1)).default([]),
  gradient: z.string().trim().min(1).default("default"),
  shortcuts: z.array(ShortcutSchema).default([]),
});

const getUserBackedActor = (c: Context<AuthContext>) => {
  const actor = c.get("actor");
  return actor.kind === "user" ? actor.user : actor.delegatedUser;
};

const requireUserBackedActor = (c: Context<AuthContext>): Result<NonNullable<ReturnType<typeof getUserBackedActor>>> => {
  const user = getUserBackedActor(c);
  if (!user) return fail(err.forbidden("Dashboard settings require a user-backed actor"));
  return ok(user);
};

const apiRoutes = new Hono<AuthContext>()
  .use(auth.requireRole("authenticated"))
  .get("/settings", async (c) => {
    const user = requireUserBackedActor(c);
    if (!user.ok) return respond(c, user);
    return c.json((await dashboardSettingsService.get(user.data.id)).settings);
  })
  .put("/settings", v("json", SettingsSchema), async (c) => {
    const user = requireUserBackedActor(c);
    if (!user.ok) return respond(c, user);
    return c.json(await dashboardSettingsService.save(user.data.id, c.req.valid("json")));
  });

export default apiRoutes;
export type ApiType = typeof apiRoutes;
