import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { trace } from "./trace";

const canUseTraceDatabase = async (): Promise<boolean> => {
  try {
    const [row] = await sql<{ spans: string | null; events: string | null }[]>`
      SELECT
        to_regclass('logging.trace_spans')::text AS spans,
        to_regclass('logging.trace_events')::text AS events
    `;
    return Boolean(row?.spans && row.events);
  } catch {
    return false;
  }
};

describe("logging.trace", () => {
  test("starts one keyed span safely under concurrency", async () => {
    if (!(await canUseTraceDatabase())) {
      console.warn("Skipping trace DB test: logging trace tables are not available.");
      return;
    }

    const suffix = crypto.randomUUID();
    const source = `test:trace:concurrent:${suffix}`;
    const spanKey = `${source}:run`;
    const originalError = console.error;
    const startErrors: string[] = [];
    console.error = (...args: unknown[]) => {
      if (args[0] === "[logging:trace] span start failed:") {
        startErrors.push(args.map(String).join(" "));
        return;
      }
      originalError(...args);
    };

    try {
      const contexts = await Promise.all(Array.from({ length: 50 }, () => trace.start({ name: "Concurrent trace test", source, spanKey })));
      expect(startErrors).toEqual([]);
      expect(new Set(contexts.map((context) => `${context.traceId}:${context.spanId}`)).size).toBe(1);

      const [stored] = await sql<Array<{ count: number }>>`
        SELECT count(*)::int AS count
        FROM logging.trace_spans
        WHERE span_key = ${spanKey}
      `;
      expect(stored?.count).toBe(1);
    } finally {
      console.error = originalError;
      await sql`DELETE FROM logging.trace_spans WHERE source = ${source}`;
    }
  });

  test("records span events and redacts sensitive metadata", async () => {
    if (!(await canUseTraceDatabase())) {
      console.warn("Skipping trace DB test: logging trace tables are not available.");
      return;
    }

    const suffix = crypto.randomUUID();
    const source = `test:trace:${suffix}`;
    const spanKey = `test:trace:${suffix}`;
    const definitionSpanKey = `sync:schedule-definition:${source}:cleanup`;
    const span = await trace.start({
      name: "Trace test",
      source,
      spanKey,
      attributes: { apiKey: "secret", safe: "ok" },
    });
    const definitionSpan = await trace.start({
      name: "Trace test.scheduled",
      source,
      spanKey: definitionSpanKey,
      category: "schedule",
      attributes: { safe: "definition" },
    });

    try {
      await trace.record({
        context: span,
        event: "test.step",
        attributes: { accessToken: "token", count: 1 },
      });
      await trace.end({
        context: span,
        status: "ok",
        summary: { password: "secret", kept: "yes" },
      });
      await trace.end({ context: definitionSpan, status: "ok" });

      const result = await trace.list(
        { page: 1, perPage: 10, offset: 0 },
        { filter: { source, search: spanKey, excludeDefinitions: true } },
      );
      expect(result.total).toBe(1);
      expect(result.spans[0]).toMatchObject({
        spanKey,
        status: "ok",
        eventCount: 1,
      });
      expect(result.spans[0]?.attributes).toMatchObject({ apiKey: "[REDACTED]", safe: "ok" });
      expect(result.spans[0]?.summary).toMatchObject({ password: "[REDACTED]", kept: "yes" });

      const events = await trace.events({ traceId: span.traceId, spanId: span.spanId });
      expect(events).toHaveLength(1);
      expect(events[0]?.attributes).toMatchObject({ accessToken: "[REDACTED]", count: 1 });

      const groups = await trace.sourceGroups({ filter: { source, excludeDefinitions: true } });
      expect(groups).toHaveLength(1);
      expect(groups[0]).toMatchObject({ source, runs: 1, failed: 0 });

      const stats = await trace.stats({ filter: { source, excludeDefinitions: true } });
      expect(stats).toMatchObject({ runs: 1, sources: 1, failed: 0 });

      const fetched = await trace.getSpan({ traceId: span.traceId, spanId: span.spanId });
      expect(fetched?.spanKey).toBe(spanKey);
    } finally {
      await sql`DELETE FROM logging.trace_spans WHERE source = ${source}`;
    }
  });

  test("source groups keep latest status separate from window error stats", async () => {
    if (!(await canUseTraceDatabase())) {
      console.warn("Skipping trace DB test: logging trace tables are not available.");
      return;
    }

    const suffix = crypto.randomUUID();
    const source = `test:trace:latest:${suffix}`;
    const now = Date.now();
    const failedSpan = await trace.start({
      name: "Older failed run",
      source,
      spanKey: `test:trace:latest:${suffix}:failed`,
      startedAt: now - 60_000,
    });
    const healthySpan = await trace.start({
      name: "Latest healthy run",
      source,
      spanKey: `test:trace:latest:${suffix}:healthy`,
      startedAt: now,
    });

    try {
      await trace.end({ context: failedSpan, status: "error", endedAt: now - 59_500 });
      await trace.end({ context: healthySpan, status: "ok", endedAt: now + 500 });

      const groups = await trace.sourceGroups({ filter: { source, excludeDefinitions: true } });

      expect(groups).toHaveLength(1);
      expect(groups[0]).toMatchObject({
        source,
        runs: 2,
        failed: 1,
        errorRate: 50,
        latestName: "Latest healthy run",
        latestStatus: "ok",
      });
    } finally {
      await sql`DELETE FROM logging.trace_spans WHERE source = ${source}`;
    }
  });

  test("cleanup removes only completed traces outside retention", async () => {
    if (!(await canUseTraceDatabase())) {
      console.warn("Skipping trace DB test: logging trace tables are not available.");
      return;
    }

    const suffix = crypto.randomUUID();
    const source = `test:trace:cleanup:${suffix}`;
    const old = await trace.start({ name: "Old trace", source, startedAt: Date.now() - 40 * 86_400_000 });
    const recent = await trace.start({ name: "Recent trace", source });
    const running = await trace.start({ name: "Running trace", source, startedAt: Date.now() - 40 * 86_400_000 });

    try {
      await trace.end({ context: old, status: "ok", endedAt: Date.now() - 39 * 86_400_000 });
      await trace.end({ context: recent, status: "ok" });

      expect(await trace.cleanup({ days: 30, source })).toBe(1);
      expect(await trace.getSpan({ traceId: old.traceId, spanId: old.spanId })).toBeNull();
      expect(await trace.getSpan({ traceId: recent.traceId, spanId: recent.spanId })).not.toBeNull();
      expect(await trace.getSpan({ traceId: running.traceId, spanId: running.spanId })).not.toBeNull();
    } finally {
      await sql`DELETE FROM logging.trace_spans WHERE source = ${source}`;
    }
  });
});
