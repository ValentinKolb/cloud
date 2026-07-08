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
});
