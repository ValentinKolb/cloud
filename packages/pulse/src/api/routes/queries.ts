import { jsonResponse, respond, v, type AuthContext } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { pulseService } from "../../service";
import {
  CompileTextQuerySchema,
  MetricQueryResultSchema,
  MetricQuerySchema,
  QueryCompileResultSchema,
  QueryTextSchema,
} from "../schemas";

const routes = new Hono<AuthContext>()
  .post(
    "/query/metric",
    describeRoute({
      tags: ["Pulse"],
      summary: "Run a Pulse metric query",
      responses: { 200: jsonResponse(z.array(z.object({ bucket: z.string(), value: z.number().nullable() })), "Query points") },
    }),
    v("json", MetricQuerySchema),
    async (c) => respond(c, pulseService.query.metric({ kind: "metric", ...c.req.valid("json") }, c.get("user"))),
  )
  .post(
    "/query/metric-text",
    describeRoute({
      tags: ["Pulse"],
      summary: "Run a Pulse query from text DSL",
      responses: { 200: jsonResponse(MetricQueryResultSchema, "Compiled query and results") },
    }),
    v("json", QueryTextSchema),
    async (c) => respond(c, pulseService.query.metricText({ ...c.req.valid("json"), user: c.get("user") })),
  )
  .post(
    "/query/compile-text",
    describeRoute({
      tags: ["Pulse"],
      summary: "Compile a Pulse query without running it",
      responses: { 200: jsonResponse(QueryCompileResultSchema, "Query diagnostics") },
    }),
    v("json", CompileTextQuerySchema),
    async (c) => respond(c, pulseService.query.compileText({ ...c.req.valid("json"), user: c.get("user") })),
  );

export default routes;
