import { type AuthContext, respond, v } from "@valentinkolb/cloud/server";
import { ok } from "@valentinkolb/stdlib";
import { Hono } from "hono";
import { z } from "zod";
import { createMetricsToken, getMetricsSnapshot, listMetricsTokens, revokeMetricsToken } from "./service";

const CreateMetricsTokenSchema = z.object({
  name: z.string().trim().min(1).max(120),
  expiresAt: z.string().nullable().optional(),
});

export const metricsApiRoutes = new Hono<AuthContext>()
  .get("/snapshot", async (c) => {
    const snapshot = await getMetricsSnapshot();
    return respond(
      c,
      ok({
        generatedAt: snapshot.generatedAt,
        series: snapshot.series,
        collectors: snapshot.collectors,
      }),
    );
  })
  .get("/tokens", async (c) => respond(c, ok({ items: await listMetricsTokens() })))
  .post("/tokens", v("json", CreateMetricsTokenSchema), async (c) =>
    respond(c, createMetricsToken(c.req.valid("json"), c.get("user")), 201),
  )
  .delete("/tokens/:id", async (c) => {
    const result = await revokeMetricsToken(c.req.param("id"), c.get("user"));
    if (!result.ok) return respond(c, result);
    return respond(c, ok({ message: "Metrics token revoked." }));
  });

export type MetricsApiType = typeof metricsApiRoutes;
