import { type AuthContext, auth, v } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { z } from "zod";
import { dashboardSettingsService } from "../service";

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
    href: z.string().trim().min(1).max(2_000).refine(safeLinkHref, "Use a relative, HTTP(S), or mailto link."),
    title: z.string().trim().min(1).max(80),
    icon: z.string().trim().min(1).max(120),
  }),
]);

const SettingsSchema = z.object({
  hiddenWidgets: z.array(z.string().min(1)).default([]),
  gradient: z.string().trim().min(1).default("default"),
  shortcuts: z.array(ShortcutSchema).default([]),
});

const apiRoutes = new Hono<AuthContext>()
  .use(auth.requireRole("authenticated"))
  .get("/settings", async (c) => {
    const user = c.get("user");
    return c.json((await dashboardSettingsService.get(user.id)).settings);
  })
  .put("/settings", v("json", SettingsSchema), async (c) => {
    const user = c.get("user");
    return c.json(await dashboardSettingsService.save(user.id, c.req.valid("json")));
  });

export default apiRoutes;
export type ApiType = typeof apiRoutes;
