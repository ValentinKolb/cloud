import { jsonResponse, respond, v, type AuthContext } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { pulseService } from "../../service";
import {
  ActivitySearchQuerySchema,
  CurrentStateSchema,
  IngestBatchSchema,
  InventorySchema,
  MetricSeriesQuerySchema,
  MetricSeriesSchema,
  MetricsQuerySchema,
  RecordedEventSchema,
  ResourceEventQuerySchema,
  ResourceListQuerySchema,
  ResourceMetricQuerySchema,
  ResourceMetricSchema,
  ResourceStateQuerySchema,
  ResourceSummarySchema,
  SignalFieldQuerySchema,
  SignalFieldSchema,
} from "../schemas";
import { requestAccessScope, requireUuidParam } from "../shared";

const routes = new Hono<AuthContext>()
  .get("/bases/:baseId/metrics", v("query", MetricsQuerySchema), async (c) => {
    const baseId = requireUuidParam(c.req.param("baseId"), "base ID");
    if (!baseId.ok) return respond(c, baseId.result);
    return respond(c, pulseService.query.metrics(baseId.value, requestAccessScope(c), c.req.valid("query")));
  })
  .get(
    "/bases/:baseId/resources",
    describeRoute({
      tags: ["Pulse"],
      summary: "List observed Pulse resources for a base",
      responses: { 200: jsonResponse(z.array(ResourceSummarySchema), "Observed resources") },
    }),
    v("query", ResourceListQuerySchema),
    async (c) => {
      const baseId = requireUuidParam(c.req.param("baseId"), "base ID");
      if (!baseId.ok) return respond(c, baseId.result);
      return respond(c, pulseService.query.resources(baseId.value, requestAccessScope(c), c.req.valid("query")));
    },
  )
  .get(
    "/bases/:baseId/fields",
    describeRoute({
      tags: ["Pulse"],
      summary: "List observed Pulse telemetry fields",
      responses: { 200: jsonResponse(z.array(SignalFieldSchema), "Observed telemetry fields") },
    }),
    v("query", SignalFieldQuerySchema),
    async (c) => {
      const baseId = requireUuidParam(c.req.param("baseId"), "base ID");
      if (!baseId.ok) return respond(c, baseId.result);
      return respond(c, pulseService.query.fields(baseId.value, requestAccessScope(c), c.req.valid("query")));
    },
  )
  .get(
    "/bases/:baseId/inventory",
    describeRoute({
      tags: ["Pulse"],
      summary: "List Pulse resources and related signals for a base",
      responses: { 200: jsonResponse(InventorySchema, "Pulse resource inventory") },
    }),
    async (c) => {
      const baseId = requireUuidParam(c.req.param("baseId"), "base ID");
      if (!baseId.ok) return respond(c, baseId.result);
      return respond(c, pulseService.query.inventory(baseId.value, requestAccessScope(c)));
    },
  )
  .get(
    "/bases/:baseId/resource-metrics",
    describeRoute({
      tags: ["Pulse"],
      summary: "List metric variants for one Pulse resource",
      responses: { 200: jsonResponse(z.array(ResourceMetricSchema), "Resource metrics") },
    }),
    v("query", ResourceMetricQuerySchema),
    async (c) => {
      const baseId = requireUuidParam(c.req.param("baseId"), "base ID");
      if (!baseId.ok) return respond(c, baseId.result);
      return respond(c, pulseService.query.resourceMetrics(baseId.value, requestAccessScope(c), c.req.valid("query")));
    },
  )
  .get(
    "/bases/:baseId/resource-events",
    describeRoute({
      tags: ["Pulse"],
      summary: "List recent events for one Pulse resource",
      responses: { 200: jsonResponse(z.array(RecordedEventSchema), "Resource events") },
    }),
    v("query", ResourceEventQuerySchema),
    async (c) => {
      const baseId = requireUuidParam(c.req.param("baseId"), "base ID");
      if (!baseId.ok) return respond(c, baseId.result);
      return respond(c, pulseService.query.resourceEvents(baseId.value, requestAccessScope(c), c.req.valid("query")));
    },
  )
  .get(
    "/bases/:baseId/resource-states",
    describeRoute({
      tags: ["Pulse"],
      summary: "List current states for one Pulse resource",
      responses: { 200: jsonResponse(z.array(CurrentStateSchema), "Resource states") },
    }),
    v("query", ResourceStateQuerySchema),
    async (c) => {
      const baseId = requireUuidParam(c.req.param("baseId"), "base ID");
      if (!baseId.ok) return respond(c, baseId.result);
      return respond(c, pulseService.query.resourceStates(baseId.value, requestAccessScope(c), c.req.valid("query")));
    },
  )
  .get(
    "/bases/:baseId/recent-events",
    describeRoute({
      tags: ["Pulse"],
      summary: "List recent Pulse events for a base",
      responses: { 200: jsonResponse(z.array(RecordedEventSchema), "Recent events") },
    }),
    v("query", ActivitySearchQuerySchema),
    async (c) => {
      const baseId = requireUuidParam(c.req.param("baseId"), "base ID");
      if (!baseId.ok) return respond(c, baseId.result);
      return respond(c, pulseService.query.recentEvents(baseId.value, requestAccessScope(c), c.req.valid("query")));
    },
  )
  .get(
    "/bases/:baseId/states",
    describeRoute({
      tags: ["Pulse"],
      summary: "List current Pulse states for a base",
      responses: { 200: jsonResponse(z.array(CurrentStateSchema), "Current states") },
    }),
    v("query", ActivitySearchQuerySchema),
    async (c) => {
      const baseId = requireUuidParam(c.req.param("baseId"), "base ID");
      if (!baseId.ok) return respond(c, baseId.result);
      return respond(c, pulseService.query.currentStates(baseId.value, requestAccessScope(c), c.req.valid("query")));
    },
  )
  .get(
    "/bases/:baseId/series",
    describeRoute({
      tags: ["Pulse"],
      summary: "List metric series for a Pulse base",
      responses: { 200: jsonResponse(z.array(MetricSeriesSchema), "Metric series") },
    }),
    v("query", MetricSeriesQuerySchema),
    async (c) => {
      const baseId = requireUuidParam(c.req.param("baseId"), "base ID");
      if (!baseId.ok) return respond(c, baseId.result);
      return respond(c, pulseService.query.series(baseId.value, requestAccessScope(c), c.req.valid("query")));
    },
  )
  .post(
    "/bases/:baseId/ingest",
    describeRoute({
      tags: ["Pulse"],
      summary: "Ingest Pulse data through authenticated internal API",
      responses: { 200: jsonResponse(z.object({ metrics: z.number(), events: z.number(), states: z.number() }), "Ingest counts") },
    }),
    v("json", IngestBatchSchema),
    async (c) => {
      const baseId = requireUuidParam(c.req.param("baseId"), "base ID");
      if (!baseId.ok) return respond(c, baseId.result);
      const gate = await pulseService.base.access.require(baseId.value, requestAccessScope(c), "write");
      if (!gate.ok) return respond(c, gate);
      return respond(c, pulseService.ingest.batch({ baseId: baseId.value, batch: c.req.valid("json") }));
    },
  );

export default routes;
