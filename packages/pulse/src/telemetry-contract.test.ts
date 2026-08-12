import { describe, expect, test } from "bun:test";
import {
  PULSE_EVENT_ATTRIBUTES_MAX_BYTES,
  PULSE_EVENT_SENSITIVE_MAX_BYTES,
  PULSE_RESOURCE_KEY_MAX_LENGTH,
  validateDimensions,
  validateEventAttributes,
  validateEventPayload,
  validateEventSensitive,
  validateResourceIdentity,
} from "./telemetry-contract";

describe("Pulse telemetry contract", () => {
  test("accepts bounded dimensions and nested high-cardinality attributes", () => {
    expect(validateDimensions({ campaign: "summer", country: "DE" })).toBeNull();
    expect(
      validateEventAttributes({
        url: "https://example.com/pricing?request=unique",
        request_id: "request-unique",
        geo: { city: "Berlin", latitude: 52.52, longitude: 13.405 },
      }),
    ).toBeNull();
  });

  test("rejects oversized attributes and invalid JSON values", () => {
    expect(validateEventAttributes({ value: "x".repeat(PULSE_EVENT_ATTRIBUTES_MAX_BYTES) })).toContain("cannot exceed");
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(validateEventPayload(cyclic)).toBe("Event payload must be valid JSON");
  });

  test("accepts bounded sensitive event data and rejects oversized values", () => {
    expect(
      validateEventSensitive({
        ip: "203.0.113.42",
        geo: { city: "Berlin", latitude: 52.52, longitude: 13.405 },
      }),
    ).toBeNull();
    expect(validateEventSensitive({ ip: "x".repeat(PULSE_EVENT_SENSITIVE_MAX_BYTES) })).toContain("cannot exceed");
  });

  test("bounds observed resource keys for composite Cloud resource refs", () => {
    const type = "service";
    const allowedId = "a".repeat(PULSE_RESOURCE_KEY_MAX_LENGTH - type.length - 1);
    expect(validateResourceIdentity(type, allowedId)).toBeNull();
    expect(validateResourceIdentity(type, `${allowedId}a`)).toBe("Resource key cannot exceed 505 characters");
  });
});
