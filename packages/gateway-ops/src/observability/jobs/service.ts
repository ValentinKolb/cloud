import {
  schedulerControl,
  SchedulerControlNotFoundError,
  SchedulerControlTimeoutError,
  SchedulerControlUnavailableError,
  type SchedulerControl,
  type SchedulerControlInfo,
  type SchedulerControlState,
} from "@valentinkolb/sync";
import type { TraceCategory, TraceSourceGroup } from "@valentinkolb/cloud/services";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";

export type ScheduleMetadata = {
  appId: string | null;
  family: string;
  label: string;
  source: string;
  resourceKind: string | null;
  resourceId: string | null;
  resourceLabel: string | null;
  detailHref: string | null;
};

export type ScheduleOverviewRow = ScheduleMetadata & {
  kind: "schedule";
  schedulerId: string;
  scheduleId: string;
  cron: string;
  tz: string;
  createdAt: number;
  updatedAt: number;
  nextRunAt: number;
  runNumber: number;
  failureCount: number;
  state: SchedulerControlState;
  lastError: string | null;
  trace: TraceSourceGroup | null;
};

export type TraceOnlyOverviewRow = {
  kind: "trace";
  schedulerId: null;
  scheduleId: null;
  cron: null;
  tz: null;
  createdAt: null;
  updatedAt: null;
  nextRunAt: null;
  runNumber: null;
  failureCount: null;
  state: "trace-only";
  lastError: null;
  appId: string | null;
  family: string;
  label: string;
  source: string;
  resourceKind: null;
  resourceId: null;
  resourceLabel: null;
  detailHref: null;
  trace: TraceSourceGroup;
};

export type BackgroundJobOverviewRow = ScheduleOverviewRow | TraceOnlyOverviewRow;

export type BackgroundJobOverviewFilter = {
  source?: string | null;
  search?: string;
  type?: "all" | TraceCategory;
  health?: "all" | "failed" | "running" | "healthy";
  requireTraceMatch?: boolean;
};

export type RunScheduleNowInput = {
  schedulerId: string;
  scheduleId: string;
  requestId?: string;
  timeoutMs?: number;
};

export type RunScheduleNowAccepted = {
  message: string;
  schedulerId: string;
  scheduleId: string;
  acceptedAt: string;
};

type SchedulerControlLike = Pick<SchedulerControl, "list" | "runNow">;

const clean = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const cleanDetailHref = (value: unknown): string | null => {
  const href = clean(value);
  if (!href) return null;
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  return href;
};

export const normalizeScheduleMetadata = (schedule: Pick<SchedulerControlInfo, "scheduleId" | "schedulerId" | "meta">): ScheduleMetadata => {
  const meta = schedule.meta && typeof schedule.meta === "object" ? schedule.meta : {};
  const source = clean(meta.source) ?? schedule.scheduleId;
  return {
    appId: clean(meta.appId),
    family: clean(meta.family) ?? source,
    label: clean(meta.label) ?? schedule.scheduleId,
    source,
    resourceKind: clean(meta.resourceKind),
    resourceId: clean(meta.resourceId),
    resourceLabel: clean(meta.resourceLabel),
    detailHref: cleanDetailHref(meta.detailHref),
  };
};

const traceOnlyLabel = (group: TraceSourceGroup): string => group.latestName ?? group.names[0] ?? group.source;

export const buildBackgroundJobRows = (
  schedules: SchedulerControlInfo[],
  groups: TraceSourceGroup[],
): BackgroundJobOverviewRow[] => {
  const groupsBySource = new Map(groups.map((group) => [group.source, group]));
  const scheduledSources = new Set<string>();

  const rows: BackgroundJobOverviewRow[] = schedules.map((schedule) => {
    const meta = normalizeScheduleMetadata(schedule);
    scheduledSources.add(meta.source);
    return {
      kind: "schedule",
      schedulerId: schedule.schedulerId,
      scheduleId: schedule.scheduleId,
      cron: schedule.cron,
      tz: schedule.tz,
      createdAt: schedule.createdAt,
      updatedAt: schedule.updatedAt,
      nextRunAt: schedule.nextRunAt,
      runNumber: schedule.runNumber,
      failureCount: schedule.failureCount,
      state: schedule.state,
      lastError: schedule.lastError ?? null,
      trace: groupsBySource.get(meta.source) ?? null,
      ...meta,
    };
  });

  for (const group of groups) {
    if (scheduledSources.has(group.source)) continue;
    rows.push({
      kind: "trace",
      schedulerId: null,
      scheduleId: null,
      cron: null,
      tz: null,
      createdAt: null,
      updatedAt: null,
      nextRunAt: null,
      runNumber: null,
      failureCount: null,
      state: "trace-only",
      lastError: null,
      appId: group.appId,
      family: group.source,
      label: traceOnlyLabel(group),
      source: group.source,
      resourceKind: null,
      resourceId: null,
      resourceLabel: null,
      detailHref: null,
      trace: group,
    });
  }

  return rows.sort((a, b) => {
    const app = (a.appId ?? "").localeCompare(b.appId ?? "");
    if (app !== 0) return app;
    const family = a.family.localeCompare(b.family);
    if (family !== 0) return family;
    const label = a.label.localeCompare(b.label);
    if (label !== 0) return label;
    return `${a.schedulerId ?? ""}:${a.scheduleId ?? ""}`.localeCompare(`${b.schedulerId ?? ""}:${b.scheduleId ?? ""}`);
  });
};

const rowMatchesSearch = (row: BackgroundJobOverviewRow, search: string): boolean => {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return [
    row.appId,
    row.family,
    row.label,
    row.resourceKind,
    row.resourceId,
    row.resourceLabel,
    row.detailHref,
    row.source,
    row.schedulerId,
    row.scheduleId,
    row.trace?.latestName,
    row.trace?.names.join(" "),
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(needle));
};

const rowMatchesHealth = (row: BackgroundJobOverviewRow, health: BackgroundJobOverviewFilter["health"]): boolean => {
  if (!health || health === "all") return true;
  const trace = row.trace;
  if (!trace) return false;
  if (health === "running") return Boolean(trace.latestStartedAt && !trace.latestEndedAt);
  if (health === "failed") return trace.latestStatus === "error";
  if (health === "healthy") return trace.latestStatus === "ok";
  return true;
};

const rowMatchesType = (row: BackgroundJobOverviewRow, type: BackgroundJobOverviewFilter["type"]): boolean => {
  if (!type || type === "all") return true;
  if (row.kind === "schedule") return type === "schedule";
  return row.trace.categories.includes(type);
};

export const filterBackgroundJobRows = (
  rows: BackgroundJobOverviewRow[],
  filter: BackgroundJobOverviewFilter,
): BackgroundJobOverviewRow[] =>
  rows.filter((row) => {
    if (filter.source && row.source !== filter.source) return false;
    if (filter.requireTraceMatch && !row.trace) return false;
    if (!rowMatchesSearch(row, filter.search ?? "")) return false;
    if (!rowMatchesType(row, filter.type)) return false;
    if (!rowMatchesHealth(row, filter.health)) return false;
    return true;
  });

export const listSchedulesWithControl = (control: SchedulerControlLike): Promise<SchedulerControlInfo[]> => control.list();

const scheduleControlError = (error: unknown) => {
  if (error instanceof SchedulerControlNotFoundError) return err.notFound("Schedule not found");
  if (error instanceof SchedulerControlTimeoutError) return err.conflict("Timed out while waiting for the schedule handler to accept the run");
  if (error instanceof SchedulerControlUnavailableError) return err.conflict("Schedule is unavailable because no live handler registered it");
  return err.internal(error instanceof Error ? error.message : String(error));
};

export const runScheduleNowWithControl = async (
  control: SchedulerControlLike,
  input: RunScheduleNowInput,
): Promise<Result<RunScheduleNowAccepted>> => {
  const schedulerId = input.schedulerId.trim();
  const scheduleId = input.scheduleId.trim();
  if (!schedulerId) return fail(err.badInput("Scheduler ID is required"));
  if (!scheduleId) return fail(err.badInput("Schedule ID is required"));

  try {
    await control.runNow({
      schedulerId,
      scheduleId,
      requestId: input.requestId,
      timeoutMs: input.timeoutMs ?? 5000,
    });
    return ok({
      message: "Schedule run accepted",
      schedulerId,
      scheduleId,
      acceptedAt: new Date().toISOString(),
    });
  } catch (error) {
    return fail(scheduleControlError(error));
  }
};

export const jobsObservabilityService = {
  listSchedules: (): Promise<SchedulerControlInfo[]> => listSchedulesWithControl(schedulerControl()),
  runScheduleNow: (input: RunScheduleNowInput): Promise<Result<RunScheduleNowAccepted>> =>
    runScheduleNowWithControl(schedulerControl(), input),
};
