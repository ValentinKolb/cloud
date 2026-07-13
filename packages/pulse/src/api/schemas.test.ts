import { describe, expect, test } from "bun:test";
import { IngestBatchSchema } from "./schemas";

describe("Pulse ingest API limits", () => {
  test("accepts the documented external maximum", () => {
    const result = IngestBatchSchema.safeParse({
      metrics: Array.from({ length: 500 }, (_, index) => ({ name: `metric.${index}`, value: index })),
      events: Array.from({ length: 500 }, (_, index) => ({ kind: `event.${index}` })),
      states: Array.from({ length: 500 }, (_, index) => ({ key: `state.${index}`, value: index })),
    });
    expect(result.success).toBe(true);
  });

  test("rejects a collection above the external maximum", () => {
    const result = IngestBatchSchema.safeParse({
      metrics: Array.from({ length: 501 }, (_, index) => ({ name: `metric.${index}`, value: index })),
    });
    expect(result.success).toBe(false);
  });

  test("accepts high-cardinality event attributes without treating them as dimensions", () => {
    const result = IngestBatchSchema.safeParse({
      events: [
        {
          kind: "page.viewed",
          actorId: "visitor:unique",
          sessionId: "session:unique",
          dimensions: { campaign: "summer", country: "DE" },
          attributes: {
            url: "https://example.com/pricing?request=unique",
            request_id: "high-cardinality-value",
          },
          sensitive: { ip: "203.0.113.42", geo: { city: "Berlin", asn: 680 } },
        },
      ],
    });

    expect(result.success).toBe(true);
  });
});
