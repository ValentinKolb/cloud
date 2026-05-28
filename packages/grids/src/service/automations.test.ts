import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { AutomationTriggerSchema } from "../contracts";
import {
  buildWebhookSignature,
  eventFor,
  filterRecordData,
  isTrustedInternalWebhookTarget,
  isUnsafeWebhookAddress,
  isUnsafeWebhookHost,
  isValidCronPart,
  parseAutomationTriggerInput,
  sanitizeRunError,
  validateSchedule,
} from "./automations";
import type { GridRecord } from "./types";

describe("automations", () => {
  test("buildWebhookSignature signs timestamp and body", () => {
    const timestamp = "2026-05-12T20:00:00.000Z";
    const body = JSON.stringify({ event: "automation.manual", input: null });
    const expected = createHmac("sha256", "secret").update(`${timestamp}.${body}`).digest("hex");

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

  test("webhook guard allows only the internal Tools receiver exception", () => {
    expect(isTrustedInternalWebhookTarget(new URL("http://app-tools:3000/tools/api/webhooks/receive/token"))).toBe(true);
    expect(isTrustedInternalWebhookTarget(new URL("http://app-tools:3000/tools/api/webhooks/send"))).toBe(false);
    expect(isTrustedInternalWebhookTarget(new URL("http://localhost:3000/tools/api/webhooks/receive/token"))).toBe(false);
    expect(isTrustedInternalWebhookTarget(new URL("https://app-tools/tools/api/webhooks/receive/token"))).toBe(false);
  });

  test("filterRecordData treats undefined as all fields and [] as no fields", () => {
    const record: GridRecord = {
      id: "00000000-0000-0000-0000-000000000001",
      tableId: "550e8400-e29b-41d4-a716-446655440002",
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
    expect(
      eventFor(
        "event",
        {
          type: "record",
          tableId: "550e8400-e29b-41d4-a716-446655440002",
          recordId: "00000000-0000-0000-0000-000000000001",
        },
        "record.updated",
      ),
    ).toBe("record.updated");
    expect(
      eventFor("manual", {
        type: "record",
        tableId: "00000000-0000-0000-0000-000000000002",
        recordId: "00000000-0000-0000-0000-000000000001",
      }),
    ).toBe("record.manual");
    expect(sanitizeRunError("connect ECONNREFUSED 10.0.0.5:6379")).toBe("Webhook request failed");
    expect(sanitizeRunError("Webhook returned HTTP 500")).toBe("Webhook returned HTTP 500");
  });

  test("record automation triggers accept event and optional table/filter config", () => {
    const parsed = AutomationTriggerSchema.safeParse({
      kind: "record",
      event: "updated",
      tableId: "550e8400-e29b-41d4-a716-446655440002",
      filter: {
        op: "AND",
        filters: [
          {
            fieldId: "00000000-0000-0000-0000-000000000003",
            op: "is_not_empty",
            value: null,
          },
        ],
      },
    });
    expect(parsed.success).toBe(true);
    expect(AutomationTriggerSchema.safeParse({ kind: "record", event: "renamed" }).success).toBe(false);
  });

  test("automation trigger input accepts legacy JSON strings but rejects invalid shapes", () => {
    const parsed = parseAutomationTriggerInput(
      JSON.stringify({
        kind: "record",
        event: "created",
        tableId: "550e8400-e29b-41d4-a716-446655440002",
      }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data).toEqual({
        kind: "record",
        event: "created",
        tableId: "550e8400-e29b-41d4-a716-446655440002",
      });
    }
    expect(parseAutomationTriggerInput(JSON.stringify({ kind: "record", event: "created" })).ok).toBe(true);
    expect(parseAutomationTriggerInput("not json").ok).toBe(false);
    expect(parseAutomationTriggerInput(JSON.stringify({ event: "created" })).ok).toBe(false);
  });
});
