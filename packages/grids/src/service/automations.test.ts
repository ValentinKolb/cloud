import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
  buildWebhookSignature,
  eventFor,
  filterRecordData,
  isUnsafeWebhookAddress,
  isUnsafeWebhookHost,
  isValidCronPart,
  sanitizeRunError,
  validateSchedule,
} from "./automations";
import type { GridRecord } from "./types";

describe("automations", () => {
  test("buildWebhookSignature signs timestamp and body", () => {
    const timestamp = "2026-05-12T20:00:00.000Z";
    const body = JSON.stringify({ event: "automation.manual", input: null });
    const expected = createHmac("sha256", "secret")
      .update(`${timestamp}.${body}`)
      .digest("hex");

    expect(buildWebhookSignature("secret", timestamp, body)).toBe(`sha256=${expected}`);
  });

  test("cron validation rejects malformed ranges and single-value steps", () => {
    expect(validateSchedule({ kind: "schedule", cron: "*/5 * * * *" }).ok).toBe(true);
    expect(validateSchedule({ kind: "schedule", cron: "0 8-18 * * 1-5", timezone: "Europe/Berlin" }).ok).toBe(true);
    expect(validateSchedule({ kind: "schedule", cron: "99 * * * *" }).ok).toBe(false);
    expect(validateSchedule({ kind: "schedule", cron: "5/2 * * * *" }).ok).toBe(false);
    expect(validateSchedule({ kind: "schedule", cron: "* * * * * *" }).ok).toBe(false);
    expect(validateSchedule({ kind: "schedule", cron: "* * * * *", timezone: "Not/AZone" }).ok).toBe(false);
    expect(isValidCronPart("*/10", 0, 59)).toBe(true);
    expect(isValidCronPart("5/10", 0, 59)).toBe(false);
  });

  test("webhook host/address guard catches local and private targets", () => {
    expect(isUnsafeWebhookHost("localhost")).toBe(true);
    expect(isUnsafeWebhookHost("metadata.google.internal")).toBe(true);
    expect(isUnsafeWebhookHost("127.0.0.1")).toBe(true);
    expect(isUnsafeWebhookAddress("10.1.2.3")).toBe(true);
    expect(isUnsafeWebhookAddress("172.16.0.1")).toBe(true);
    expect(isUnsafeWebhookAddress("192.168.1.9")).toBe(true);
    expect(isUnsafeWebhookAddress("169.254.169.254")).toBe(true);
    expect(isUnsafeWebhookAddress("8.8.8.8")).toBe(false);
  });

  test("filterRecordData treats undefined as all fields and [] as no fields", () => {
    const record: GridRecord = {
      id: "00000000-0000-0000-0000-000000000001",
      tableId: "00000000-0000-0000-0000-000000000002",
      data: { a: 1, b: 2 },
      version: 1,
      deletedAt: null,
      createdBy: null,
      updatedBy: null,
      createdAt: "2026-05-12T20:00:00.000Z",
      updatedAt: "2026-05-12T20:00:00.000Z",
    };

    expect(filterRecordData(record, {}).data).toEqual({ a: 1, b: 2 });
    expect(filterRecordData(record, { fieldIds: [] }).data).toEqual({});
    expect(filterRecordData(record, { fieldIds: ["b"] }).data).toEqual({ b: 2 });
  });

  test("eventFor and sanitizeRunError keep the public run surface stable", () => {
    expect(eventFor("manual", { type: "base" })).toBe("automation.manual");
    expect(eventFor("schedule", { type: "base" })).toBe("automation.scheduled");
    expect(eventFor("manual", {
      type: "record",
      tableId: "00000000-0000-0000-0000-000000000002",
      recordId: "00000000-0000-0000-0000-000000000001",
    })).toBe("record.manual");
    expect(sanitizeRunError("connect ECONNREFUSED 10.0.0.5:6379")).toBe("Webhook request failed");
    expect(sanitizeRunError("Webhook returned HTTP 500")).toBe("Webhook returned HTTP 500");
  });
});
