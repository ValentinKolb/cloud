import { describe, expect, test } from "bun:test";
import {
  SchedulerControlNotFoundError,
  SchedulerControlTimeoutError,
  SchedulerControlUnavailableError,
  type SchedulerControlInfo,
} from "@valentinkolb/sync";
import type { TraceSourceGroup } from "@valentinkolb/cloud/services";
import {
  buildBackgroundJobRows,
  filterBackgroundJobRows,
  normalizeScheduleMetadata,
  runScheduleNowWithControl,
} from "./service";

const schedule = (overrides: Partial<SchedulerControlInfo> = {}): SchedulerControlInfo => ({
  schedulerId: "gateway-ops-lifecycle",
  scheduleId: "gateway:health-webhook-check",
  cron: "*/5 * * * *",
  tz: "Europe/Berlin",
  createdAt: 1,
  updatedAt: 2,
  nextRunAt: 3,
  runNumber: 4,
  failureCount: 0,
  state: "available",
  meta: {
    appId: "gateway-ops",
    family: "gateway:health",
    label: "Gateway health webhook check",
    source: "gateway:health-webhook-check",
  },
  ...overrides,
});

const group = (source: string, overrides: Partial<TraceSourceGroup> = {}): TraceSourceGroup => ({
  source,
  appId: "gateway-ops",
  categories: ["schedule"],
  names: ["Gateway health webhook check"],
  runs: 10,
  jobRuns: 0,
  scheduleRuns: 10,
  aiRuns: 0,
  customRuns: 0,
  running: 0,
  succeeded: 9,
  failed: 1,
  errorRate: 10,
  avgDurationMs: 42,
  p95DurationMs: 84,
  p99DurationMs: 100,
  latestName: "Gateway health webhook check",
  latestCategory: "schedule",
  latestStatus: "ok",
  latestStartedAt: "2026-07-09T12:00:00.000Z",
  latestEndedAt: "2026-07-09T12:00:00.050Z",
  latestDurationMs: 50,
  ...overrides,
});

describe("jobs observability service", () => {
  test("normalizes scheduler meta with safe fallbacks", () => {
    expect(normalizeScheduleMetadata(schedule())).toEqual({
      appId: "gateway-ops",
      family: "gateway:health",
      label: "Gateway health webhook check",
      source: "gateway:health-webhook-check",
      resourceLabel: null,
    });

    expect(normalizeScheduleMetadata(schedule({ meta: { label: "  " } }))).toEqual({
      appId: null,
      family: "gateway:health-webhook-check",
      label: "gateway:health-webhook-check",
      source: "gateway:health-webhook-check",
      resourceLabel: null,
    });
  });

  test("builds schedule rows joined by trace source and keeps trace-only rows", () => {
    const rows = buildBackgroundJobRows([schedule()], [
      group("gateway:health-webhook-check"),
      group("auth:ipa:backfill", { categories: ["job"], latestName: "IPA backfill" }),
    ]);

    const scheduleRow = rows.find((row) => row.kind === "schedule");
    expect(scheduleRow).toMatchObject({
      kind: "schedule",
      schedulerId: "gateway-ops-lifecycle",
      scheduleId: "gateway:health-webhook-check",
      source: "gateway:health-webhook-check",
      trace: { runs: 10, failed: 1 },
    });

    const traceOnlyRow = rows.find((row) => row.kind === "trace");
    expect(traceOnlyRow).toMatchObject({
      kind: "trace",
      source: "auth:ipa:backfill",
      label: "IPA backfill",
      state: "trace-only",
    });
  });

  test("filters rows by type, health, source, search, and trace requirement", () => {
    const rows = buildBackgroundJobRows(
      [
        schedule(),
        schedule({
          scheduleId: "gateway:telemetry:cleanup",
          meta: { appId: "gateway-ops", family: "gateway:telemetry", label: "Gateway telemetry cleanup", source: "gateway:telemetry:cleanup" },
        }),
      ],
      [group("gateway:health-webhook-check"), group("auth:ipa:backfill", { categories: ["job"], latestStatus: "error" })],
    );

    expect(filterBackgroundJobRows(rows, { search: "telemetry" }).map((row) => row.source)).toEqual(["gateway:telemetry:cleanup"]);
    expect(filterBackgroundJobRows(rows, { type: "job" }).map((row) => row.source)).toEqual(["auth:ipa:backfill"]);
    expect(filterBackgroundJobRows(rows, { health: "failed" }).map((row) => row.source)).toEqual(["auth:ipa:backfill"]);
    expect(filterBackgroundJobRows(rows, { source: "gateway:health-webhook-check" }).map((row) => row.source)).toEqual([
      "gateway:health-webhook-check",
    ]);
    expect(filterBackgroundJobRows(rows, { requireTraceMatch: true }).map((row) => row.source).sort()).toEqual([
      "auth:ipa:backfill",
      "gateway:health-webhook-check",
    ]);
  });

  test("runScheduleNowWithControl maps accepted and schedulerControl failures", async () => {
    const accepted = await runScheduleNowWithControl(
      {
        list: async () => [],
        runNow: async () => {},
      },
      { schedulerId: "gateway-ops-lifecycle", scheduleId: "gateway:health-webhook-check" },
    );
    expect(accepted).toMatchObject({ ok: true, data: { message: "Schedule run accepted" } });

    const notFound = await runScheduleNowWithControl(
      {
        list: async () => [],
        runNow: async () => {
          throw new SchedulerControlNotFoundError("missing");
        },
      },
      { schedulerId: "missing", scheduleId: "missing" },
    );
    expect(notFound).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });

    const unavailable = await runScheduleNowWithControl(
      {
        list: async () => [],
        runNow: async () => {
          throw new SchedulerControlUnavailableError("offline");
        },
      },
      { schedulerId: "gateway-ops-lifecycle", scheduleId: "gateway:health-webhook-check" },
    );
    expect(unavailable).toMatchObject({ ok: false, error: { code: "CONFLICT" } });

    const timeout = await runScheduleNowWithControl(
      {
        list: async () => [],
        runNow: async () => {
          throw new SchedulerControlTimeoutError("slow");
        },
      },
      { schedulerId: "gateway-ops-lifecycle", scheduleId: "gateway:health-webhook-check" },
    );
    expect(timeout).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    if (!timeout.ok) expect(timeout.error.message).toStartWith("Timed out while waiting for the schedule handler to accept the run");
  });
});
