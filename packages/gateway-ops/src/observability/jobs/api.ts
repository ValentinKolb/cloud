/**
 * Background job / trace read API.
 *
 * The trace service has had a full read surface for a while, but until now it
 * was only reachable from the admin page — so background jobs were the one
 * observability domain the CLI could not see at all. These routes expose the
 * same data the page renders: an overview joining schedules with trace stats,
 * the spans of a source, and the events of a single run.
 *
 * Read-only on purpose. Triggering a schedule stays a form POST on the page,
 * where it is an explicit human action.
 */

import { createPagination, parsePagination } from "@valentinkolb/cloud/contracts";
import { type AuthContext, auth, rateLimit, respond, v } from "@valentinkolb/cloud/server";
import { trace } from "@valentinkolb/cloud/services";
import { ok } from "@valentinkolb/stdlib";
import { Hono } from "hono";
import { z } from "zod";
import { buildBackgroundJobRows, filterBackgroundJobRows, jobsObservabilityService } from "./service";

const HealthSchema = z.enum(["all", "failed", "running", "healthy"]).default("all");
/** Mirrors TraceCategory plus the "all" passthrough the filter accepts. */
const TypeSchema = z.enum(["all", "job", "schedule", "ai", "http", "notification", "sync", "custom"]).default("all");

const OverviewQuerySchema = z.object({
  search: z.string().optional(),
  type: TypeSchema,
  health: HealthSchema,
});

const RunsQuerySchema = z.object({
  source: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  per_page: z.coerce.number().int().min(1).max(200).optional(),
});

/** `traceId:spanId`, the same key the admin page puts in its URL. */
const RunKeySchema = z.object({
  run: z.string().regex(/^[0-9a-f]{32}:[0-9a-f]{16}$/, "Run key must be <traceId>:<spanId> in hex."),
});

const parseRunKey = (value: string) => {
  const [traceId, spanId] = value.split(":");
  return { traceId: traceId ?? "", spanId: spanId ?? "" };
};

const app = new Hono<AuthContext>()
  .use(rateLimit())
  .use(auth.requireRole("admin"))

  /** Schedules joined with their trace stats — the "is anything failing" view. */
  .get("/", v("query", OverviewQuerySchema), async (c) => {
    const query = c.req.valid("query");
    // A dead scheduler must degrade to trace-only rows, not fail the request.
    const schedules = await jobsObservabilityService.listSchedules().catch(() => []);
    const groups = await trace.sourceGroups({});
    const items = filterBackgroundJobRows(buildBackgroundJobRows(schedules, groups), {
      search: query.search,
      type: query.type,
      health: query.health,
    });
    return respond(c, ok({ items }));
  })

  /** Aggregate run counts and durations across the current trace window. */
  .get("/stats", async (c) => respond(c, ok(await trace.stats({}))))

  /** Individual runs, newest first. Scope with `source` to a single job. */
  .get("/runs", v("query", RunsQuerySchema), async (c) => {
    const query = c.req.valid("query");
    const pagination = parsePagination(query);
    const filter = query.source ? { sources: [query.source] } : {};
    const result = await trace.list(pagination, { filter });
    return respond(c, ok({ items: result.spans, pagination: createPagination(pagination, result.total) }));
  })

  /** One run with its recorded events — the closest thing to a job log. */
  .get("/runs/:run", v("param", RunKeySchema), async (c) => {
    const key = parseRunKey(c.req.valid("param").run);
    const [span, events] = await Promise.all([trace.getSpan(key), trace.events({ ...key, limit: 200 })]);
    return respond(c, ok({ span, events }));
  });

export default app;
