import { sql } from "bun";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createHmac } from "node:crypto";
import { ok, fail, err, type Result } from "@valentinkolb/stdlib";
import { get as settingsGet } from "@valentinkolb/cloud/services/settings";
import {
  AutomationActionSchema,
  AutomationPayloadConfigSchema,
  AutomationSubjectSchema,
  AutomationTriggerSchema,
  type CreateAutomationInput,
  type UpdateAutomationInput,
} from "../contracts";
import { parseJsonbRow } from "./jsonb";
import { logAudit } from "./audit";
import { insertWithShortId } from "./short-id";
import { get as getTable } from "./tables";
import { listByTable as listFields } from "./fields";
import { compileFilter, renderClause } from "./filter-compiler";
import { get as getRecord } from "./records";
import type { GridsRecordEvent } from "./record-events";
import type {
  Automation,
  AutomationAction,
  AutomationPayloadConfig,
  AutomationRun,
  AutomationSubject,
  AutomationTrigger,
  GridRecord,
} from "./types";

type DbRow = Record<string, unknown>;

const AUTOMATION_COLS = sql`
  id, short_id, base_id, name, description, trigger, action, payload,
  webhook_secret, enabled, position, owner_user_id, deleted_at, created_at, updated_at
`;

const RUN_COLS = sql`
  id, automation_id, base_id, table_id, record_id, event, trigger, subject, input,
  status, target_host, http_status, duration_ms, error, created_at, started_at, finished_at
`;

const AUTOMATION_COLS_PREFIXED = sql`
  a.id, a.short_id, a.base_id, a.name, a.description, a.trigger, a.action, a.payload,
  a.webhook_secret, a.enabled, a.position, a.owner_user_id, a.deleted_at, a.created_at, a.updated_at
`;

const MAX_INPUT_BYTES = 64 * 1024;
const DEFAULT_WEBHOOK_TIMEOUT_MS = 15_000;
const MAX_WEBHOOK_TIMEOUT_MS = 60_000;
const DEFAULT_STALE_RUNNING_SECONDS = 300;
const DEFAULT_RUN_RETENTION_DAYS = 90;
const PRIVATE_WEBHOOKS_SETTING = "grids.webhook_allow_private_networks";
const RUN_RETENTION_SETTING = "grids.automation_run_retention_days";

type AutomationWithSecret = Automation & { webhookSecret: string | null };

const normalizeAction = (value: unknown): AutomationAction => {
  const parsed = AutomationActionSchema.safeParse(parseJsonbRow(value, value));
  if (parsed.success) return parsed.data;
  return { kind: "webhook", url: "http://invalid.local" };
};

const normalizeTrigger = (value: unknown): AutomationTrigger => {
  const parsed = AutomationTriggerSchema.safeParse(parseJsonbRow(value, value));
  return parsed.success ? parsed.data : { kind: "manual" };
};

const normalizePayload = (value: unknown): AutomationPayloadConfig => {
  const parsed = AutomationPayloadConfigSchema.safeParse(parseJsonbRow(value, value));
  return parsed.success ? parsed.data : {};
};

const normalizeSubject = (value: unknown): AutomationSubject => {
  const parsed = AutomationSubjectSchema.safeParse(value);
  return parsed.success ? parsed.data : { type: "base" };
};

const mapRow = (row: DbRow): AutomationWithSecret => ({
  id: row.id as string,
  shortId: row.short_id as string,
  baseId: row.base_id as string,
  name: row.name as string,
  description: (row.description as string | null) ?? null,
  trigger: normalizeTrigger(parseJsonbRow(row.trigger, { kind: "manual" })),
  action: normalizeAction(parseJsonbRow(row.action, null)),
  payload: normalizePayload(parseJsonbRow(row.payload, {})),
  enabled: Boolean(row.enabled),
  position: Number(row.position ?? 0),
  ownerUserId: (row.owner_user_id as string | null) ?? null,
  webhookSecretSet: Boolean(row.webhook_secret),
  webhookSecret: (row.webhook_secret as string | null) ?? null,
  deletedAt: row.deleted_at ? (row.deleted_at as Date).toISOString() : null,
  createdAt: (row.created_at as Date).toISOString(),
  updatedAt: (row.updated_at as Date).toISOString(),
});

const publicAutomation = (automation: AutomationWithSecret): Automation => {
  const { webhookSecret: _webhookSecret, ...rest } = automation;
  return rest;
};

const mapRunRow = (row: DbRow): AutomationRun => ({
  id: row.id as string,
  automationId: row.automation_id as string,
  baseId: row.base_id as string,
  tableId: (row.table_id as string | null) ?? null,
  recordId: (row.record_id as string | null) ?? null,
  event: row.event as string,
  trigger: parseJsonbRow<Record<string, unknown>>(row.trigger, {}),
  subject: normalizeSubject(parseJsonbRow(row.subject, { type: "base" })),
  input: parseJsonbRow<unknown | null>(row.input, null),
  status: row.status as AutomationRun["status"],
  targetHost: (row.target_host as string | null) ?? null,
  httpStatus: row.http_status === null || row.http_status === undefined ? null : Number(row.http_status),
  durationMs: row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
  error: (row.error as string | null) ?? null,
  createdAt: (row.created_at as Date).toISOString(),
  startedAt: row.started_at ? (row.started_at as Date).toISOString() : null,
  finishedAt: row.finished_at ? (row.finished_at as Date).toISOString() : null,
});

export const parseAutomationTriggerInput = (value: unknown): Result<AutomationTrigger> => {
  const parsed = AutomationTriggerSchema.safeParse(parseJsonbRow(value, value));
  return parsed.success ? ok(parsed.data) : fail(err.badInput("automation trigger is invalid"));
};

const parseActionInput = (value: unknown): Result<AutomationAction> => {
  const parsed = AutomationActionSchema.safeParse(parseJsonbRow(value, value));
  return parsed.success ? ok(parsed.data) : fail(err.badInput("automation action is invalid"));
};

const parsePayloadInput = (value: unknown): Result<AutomationPayloadConfig> => {
  const parsed = AutomationPayloadConfigSchema.safeParse(parseJsonbRow(value, value));
  return parsed.success ? ok(parsed.data) : fail(err.badInput("automation payload is invalid"));
};

export const validateSchedule = (trigger: AutomationTrigger): Result<void> => {
  if (trigger.kind !== "schedule") return ok();
  const parts = trigger.cron.trim().split(/\s+/);
  if (parts.length !== 5) return fail(err.badInput("schedule cron must have 5 fields"));
  const ranges = [
    { min: 0, max: 59, name: "minute" },
    { min: 0, max: 23, name: "hour" },
    { min: 1, max: 31, name: "day of month" },
    { min: 1, max: 12, name: "month" },
    { min: 0, max: 7, name: "day of week" },
  ];
  for (let i = 0; i < parts.length; i++) {
    if (!isValidCronPart(parts[i]!, ranges[i]!.min, ranges[i]!.max)) {
      return fail(err.badInput(`schedule cron has invalid ${ranges[i]!.name} field`));
    }
  }
  if (trigger.timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: trigger.timezone }).format(new Date());
    } catch {
      return fail(err.badInput("schedule timezone must be a valid IANA timezone"));
    }
  }
  return ok();
};

const validateRecordTrigger = async (baseId: string, trigger: AutomationTrigger): Promise<Result<void>> => {
  if (trigger.kind !== "record") return ok();
  if (trigger.filter && !trigger.tableId) return fail(err.badInput("record trigger filters require a table"));
  if (!trigger.tableId) return ok();
  const table = await getTable(trigger.tableId);
  if (!table || table.baseId !== baseId) return fail(err.badInput("record trigger table must belong to the automation base"));
  if (trigger.filter) {
    const fields = await listFields(trigger.tableId);
    const compiled = compileFilter(trigger.filter, fields);
    if (!compiled.ok) return fail(err.badInput(`automation filter is invalid: ${compiled.error}`));
  }
  return ok();
};

export const isValidCronPart = (part: string, min: number, max: number): boolean => {
  if (!part || !/^[0-9*/,\-]+$/.test(part)) return false;
  const atoms = part.split(",");
  return atoms.every((atom) => {
    const [range, stepRaw] = atom.split("/");
    if (stepRaw !== undefined) {
      const step = Number(stepRaw);
      if (!Number.isInteger(step) || step < 1) return false;
      if (range !== "*" && !range?.includes("-")) return false;
    }
    if (range === "*") return true;
    if (!range) return false;
    const bounds = range.split("-");
    if (bounds.length > 2) return false;
    const nums = bounds.map((value) => Number(value));
    if (nums.some((value) => !Number.isInteger(value) || value < min || value > max)) return false;
    if (nums.length === 2 && nums[0]! > nums[1]!) return false;
    return true;
  });
};

const validateInput = async (
  baseId: string,
  input: {
    trigger: AutomationTrigger;
    action: AutomationAction;
  },
): Promise<Result<void>> => {
  const schedule = validateSchedule(input.trigger);
  if (!schedule.ok) return schedule;
  const recordTrigger = await validateRecordTrigger(baseId, input.trigger);
  if (!recordTrigger.ok) return recordTrigger;
  if (input.action.kind !== "webhook") return fail(err.badInput("unsupported automation action"));
  return ok();
};

export const eventFor = (triggerKind: "manual" | "schedule" | "event", subject: AutomationSubject, eventName?: string): string => {
  if (triggerKind === "event") return eventName ?? (subject.type === "record" ? "record.event" : "automation.event");
  if (subject.type === "record") return triggerKind === "schedule" ? "record.scheduled" : "record.manual";
  return triggerKind === "schedule" ? "automation.scheduled" : "automation.manual";
};

export const buildWebhookSignature = (secret: string, timestamp: string, body: string): string =>
  `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;

const ipv4ToNumber = (ip: string): number => ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;

const ipv4InRange = (ip: string, base: string, bits: number): boolean => {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToNumber(ip) & mask) === (ipv4ToNumber(base) & mask);
};

export const isUnsafeWebhookAddress = (address: string): boolean => {
  if (isIP(address) === 4) {
    return (
      ipv4InRange(address, "0.0.0.0", 8) ||
      ipv4InRange(address, "10.0.0.0", 8) ||
      ipv4InRange(address, "127.0.0.0", 8) ||
      ipv4InRange(address, "169.254.0.0", 16) ||
      ipv4InRange(address, "172.16.0.0", 12) ||
      ipv4InRange(address, "192.168.0.0", 16)
    );
  }
  const lower = address.toLowerCase();
  if (lower.startsWith("::ffff:")) return isUnsafeWebhookAddress(lower.slice("::ffff:".length));
  return lower === "::" || lower === "::1" || lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd");
};

export const isUnsafeWebhookHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "metadata.google.internal" ||
    host.endsWith(".internal") ||
    (isIP(host) !== 0 && isUnsafeWebhookAddress(host))
  );
};

export const isTrustedInternalWebhookTarget = (url: URL): boolean =>
  url.protocol === "http:" &&
  url.hostname.toLowerCase() === "app-tools" &&
  (url.port === "" || url.port === "3000") &&
  url.pathname.startsWith("/tools/api/webhooks/receive/");

const validateWebhookTarget = async (rawUrl: string): Promise<Result<URL>> => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return fail(err.badInput("webhook URL is invalid"));
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return fail(err.badInput("webhook URL must use http or https"));
  }

  if (isTrustedInternalWebhookTarget(url)) return ok(url);

  const allowPrivate = Boolean(await settingsGet<boolean>(PRIVATE_WEBHOOKS_SETTING));
  if (allowPrivate) return ok(url);
  if (isUnsafeWebhookHost(url.hostname)) {
    return fail(err.badInput("webhook URL target is not allowed"));
  }

  try {
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (addresses.some((entry) => isUnsafeWebhookAddress(entry.address))) {
      return fail(err.badInput("webhook URL target is not allowed"));
    }
  } catch {
    // DNS failures are ordinary webhook delivery failures; fetch records them.
  }
  return ok(url);
};

export const filterRecordData = (record: GridRecord, payload: AutomationPayloadConfig): GridRecord => {
  if (!payload.fieldIds) return record;
  const allowed = new Set(payload.fieldIds);
  const data = Object.fromEntries(Object.entries(record.data).filter(([fieldId]) => allowed.has(fieldId)));
  return { ...record, data };
};

const resolveRecord = async (automation: AutomationWithSecret, subject: AutomationSubject): Promise<Result<GridRecord | null>> => {
  if (subject.type !== "record") return ok(null);
  const table = await getTable(subject.tableId);
  if (!table || table.baseId !== automation.baseId) {
    return fail(err.badInput("subject record table must belong to the automation base"));
  }
  const record = await getRecord(subject.tableId, subject.recordId, {
    includeRelations: true,
  });
  if (!record) return fail(err.notFound("record"));
  if (automation.payload.includeRecord === false) return ok(null);
  if (automation.payload.fieldIds) {
    const fields = await listFields(subject.tableId);
    const liveFieldIds = new Set(fields.map((field) => field.id));
    const unknown = automation.payload.fieldIds.filter((fieldId) => !liveFieldIds.has(fieldId));
    if (unknown.length > 0) {
      return fail(err.badInput("payload.fieldIds contains fields outside the subject table"));
    }
  }
  return ok(filterRecordData(record, automation.payload));
};

const buildPayload = (params: {
  automation: AutomationWithSecret;
  runId: string;
  event: string;
  trigger: Record<string, unknown>;
  subject: AutomationSubject;
  input: unknown | null;
  record: GridRecord | null;
}) => ({
  event: params.event,
  automationId: params.automation.id,
  runId: params.runId,
  baseId: params.automation.baseId,
  triggeredAt: new Date().toISOString(),
  trigger: params.trigger,
  subject: params.subject,
  input: params.input,
  record: params.record,
});

export const sanitizeRunError = (message: string | null): string | null => {
  if (!message) return null;
  if (/^Webhook returned HTTP [0-9]{3}$/.test(message)) return message;
  if (message === "Webhook request timed out") return message;
  if (message === "Webhook URL target is not allowed") return message;
  if (message === "Webhook request failed") return message;
  if (message === "Webhook request interrupted") return message;
  return "Webhook request failed";
};

const safeError = (error: unknown): string => {
  if (error instanceof Error && error.name === "AbortError") return "Webhook request timed out";
  return "Webhook request failed";
};

export const listForBase = async (baseId: string): Promise<Automation[]> => {
  const rows = await sql<DbRow[]>`
    SELECT ${AUTOMATION_COLS}
    FROM grids.automations
    WHERE base_id = ${baseId}::uuid AND deleted_at IS NULL
    ORDER BY position, created_at, id
  `;
  return rows.map((row) => publicAutomation(mapRow(row)));
};

export const listScheduledEnabled = async (): Promise<Automation[]> => {
  const rows = await sql<DbRow[]>`
    SELECT ${AUTOMATION_COLS_PREFIXED}
    FROM grids.automations a
    JOIN grids.bases b ON b.id = a.base_id AND b.deleted_at IS NULL
    WHERE a.deleted_at IS NULL
      AND a.enabled = TRUE
      AND a.trigger->>'kind' = 'schedule'
    ORDER BY a.created_at, a.id
  `;
  return rows.map((row) => publicAutomation(mapRow(row)));
};

export const listRecordEventEnabled = async (event: GridsRecordEvent): Promise<Automation[]> => {
  const eventName = event.type.replace("record.", "");
  const rows = await sql<DbRow[]>`
    SELECT ${AUTOMATION_COLS_PREFIXED}
    FROM grids.automations a
    JOIN grids.bases b ON b.id = a.base_id AND b.deleted_at IS NULL
    WHERE a.deleted_at IS NULL
      AND a.enabled = TRUE
      AND a.base_id = ${event.baseId}::uuid
      AND a.trigger->>'kind' = 'record'
      AND a.trigger->>'event' = ${eventName}
      AND (
        a.trigger->>'tableId' IS NULL
        OR a.trigger->>'tableId' = ${event.tableId}
      )
    ORDER BY a.created_at, a.id
  `;
  return rows.map((row) => publicAutomation(mapRow(row)));
};

export const recordMatchesAutomationFilter = async (automation: Automation, event: GridsRecordEvent): Promise<Result<boolean>> => {
  if (automation.trigger.kind !== "record" || !automation.trigger.filter) return ok(true);
  const tableId = automation.trigger.tableId ?? event.tableId;
  const fields = await listFields(tableId);
  const compiled = compileFilter(automation.trigger.filter, fields);
  if (!compiled.ok) return fail(err.badInput(`automation filter is invalid: ${compiled.error}`));
  const clause = renderClause(compiled.clause);
  const [row] = await sql<{ matched: boolean }[]>`
    SELECT EXISTS(
      SELECT 1
      FROM grids.records r
      WHERE r.id = ${event.recordId}::uuid
        AND r.table_id = ${tableId}::uuid
        AND ${event.type === "record.deleted" ? sql`TRUE` : sql`r.deleted_at IS NULL`}
        AND ${clause}
    ) AS matched
  `;
  return ok(Boolean(row?.matched));
};

export const get = async (
  id: string,
  opts: { includeDeleted?: boolean; includeSecret?: boolean } = {},
): Promise<Automation | AutomationWithSecret | null> => {
  const [row] = opts.includeDeleted
    ? await sql<DbRow[]>`
        SELECT ${AUTOMATION_COLS}
        FROM grids.automations
        WHERE id = ${id}::uuid
      `
    : await sql<DbRow[]>`
        SELECT ${AUTOMATION_COLS}
        FROM grids.automations
        WHERE id = ${id}::uuid AND deleted_at IS NULL
      `;
  if (!row) return null;
  const automation = mapRow(row);
  return opts.includeSecret ? automation : publicAutomation(automation);
};

const getWithSecret = async (id: string): Promise<AutomationWithSecret | null> => {
  const automation = await get(id, { includeSecret: true });
  return automation as AutomationWithSecret | null;
};

export const create = async (baseId: string, input: CreateAutomationInput, actorId: string | null): Promise<Result<Automation>> => {
  const name = input.name.trim();
  if (!name) return fail(err.badInput("name required"));
  const triggerResult = parseAutomationTriggerInput(input.trigger);
  if (!triggerResult.ok) return triggerResult;
  const actionResult = parseActionInput(input.action);
  if (!actionResult.ok) return actionResult;
  const payloadResult = parsePayloadInput(input.payload ?? {});
  if (!payloadResult.ok) return payloadResult;
  const trigger = triggerResult.data;
  const action = actionResult.data;
  const payload = payloadResult.data;
  const checked = await validateInput(baseId, { trigger, action });
  if (!checked.ok) return checked;

  const row = await insertWithShortId<DbRow>(async (shortId) => {
    const [r] = await sql<DbRow[]>`
      INSERT INTO grids.automations (
        short_id, base_id, name, description, trigger, action, payload,
        webhook_secret, enabled, position, owner_user_id
      )
      VALUES (
        ${shortId},
        ${baseId}::uuid,
        ${name},
        ${input.description ?? null},
        (${JSON.stringify(trigger)}::text)::jsonb,
        (${JSON.stringify(action)}::text)::jsonb,
        (${JSON.stringify(payload)}::text)::jsonb,
        ${input.webhookSecret ?? null},
        ${input.enabled ?? true},
        ${input.position ?? 0},
        ${actorId}::uuid
      )
      RETURNING ${AUTOMATION_COLS}
    `;
    if (!r) throw new Error("insert returned no row");
    return r;
  }, "idx_grids_automations_short_id");

  const automation = publicAutomation(mapRow(row));
  await logAudit({
    baseId,
    userId: actorId,
    action: "created",
    diff: { automation: { old: null, new: { id: automation.id, name: automation.name } } },
  });
  return ok(automation);
};

export const update = async (id: string, input: UpdateAutomationInput, actorId: string | null): Promise<Result<Automation>> => {
  const existing = await getWithSecret(id);
  if (!existing) return fail(err.notFound("automation"));

  const triggerResult = input.trigger === undefined ? ok(existing.trigger) : parseAutomationTriggerInput(input.trigger);
  if (!triggerResult.ok) return triggerResult;
  const actionResult = input.action === undefined ? ok(existing.action) : parseActionInput(input.action);
  if (!actionResult.ok) return actionResult;
  const payloadResult = input.payload === undefined ? ok(existing.payload) : parsePayloadInput(input.payload);
  if (!payloadResult.ok) return payloadResult;

  const next = {
    name: input.name?.trim() ?? existing.name,
    description: input.description !== undefined ? input.description : existing.description,
    trigger: triggerResult.data,
    action: actionResult.data,
    payload: payloadResult.data,
    enabled: input.enabled ?? existing.enabled,
    position: input.position ?? existing.position,
    webhookSecret: input.webhookSecret === undefined ? existing.webhookSecret : input.webhookSecret,
  };
  if (!next.name) return fail(err.badInput("name cannot be empty"));
  const checked = await validateInput(existing.baseId, { trigger: next.trigger, action: next.action });
  if (!checked.ok) return checked;

  const [row] = await sql<DbRow[]>`
    UPDATE grids.automations
    SET name = ${next.name},
        description = ${next.description},
        trigger = (${JSON.stringify(next.trigger)}::text)::jsonb,
        action = (${JSON.stringify(next.action)}::text)::jsonb,
        payload = (${JSON.stringify(next.payload)}::text)::jsonb,
        enabled = ${next.enabled},
        position = ${next.position},
        webhook_secret = ${next.webhookSecret ?? null},
        updated_at = now()
    WHERE id = ${id}::uuid AND deleted_at IS NULL
    RETURNING ${AUTOMATION_COLS}
  `;
  if (!row) return fail(err.internal("update failed"));

  const automation = publicAutomation(mapRow(row));
  await logAudit({
    baseId: automation.baseId,
    userId: actorId,
    action: "updated",
    diff: { automation: { old: { id: existing.id, name: existing.name }, new: { id: automation.id, name: automation.name } } },
  });
  return ok(automation);
};

export const remove = async (id: string, actorId: string | null): Promise<Result<void>> => {
  const existing = await getWithSecret(id);
  if (!existing) return fail(err.notFound("automation"));
  const result = await sql`
    UPDATE grids.automations
    SET deleted_at = now(), updated_at = now()
    WHERE id = ${id}::uuid AND deleted_at IS NULL
  `;
  if (result.count === 0) return fail(err.notFound("automation"));
  await logAudit({ baseId: existing.baseId, userId: actorId, action: "deleted" });
  return ok();
};

export const listRuns = async (automationId: string, limit = 50, opts: { redactErrors?: boolean } = {}): Promise<AutomationRun[]> => {
  const cap = Math.min(Math.max(limit, 1), 200);
  const rows = await sql<DbRow[]>`
    SELECT ${RUN_COLS}
    FROM grids.automation_runs
    WHERE automation_id = ${automationId}::uuid
    ORDER BY created_at DESC, id DESC
    LIMIT ${cap}
  `;
  return rows.map((row) => {
    const run = mapRunRow(row);
    return opts.redactErrors ? { ...run, error: sanitizeRunError(run.error) } : run;
  });
};

export const markStaleRunningRunsFailed = async (maxAgeSeconds = DEFAULT_STALE_RUNNING_SECONDS): Promise<number> => {
  const result = await sql`
    UPDATE grids.automation_runs
    SET status = 'failed',
        error = 'Webhook request interrupted',
        finished_at = now()
    WHERE status = 'running'
      AND started_at IS NOT NULL
      AND started_at < now() - (${maxAgeSeconds} || ' seconds')::interval
  `;
  return result.count ?? 0;
};

export const purgeOldRuns = async (retentionDays?: number): Promise<number> => {
  const configured = retentionDays ?? (await settingsGet<number>(RUN_RETENTION_SETTING));
  const days =
    typeof configured === "number" && Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : DEFAULT_RUN_RETENTION_DAYS;
  const result = await sql`
    DELETE FROM grids.automation_runs
    WHERE created_at < now() - (${days} || ' days')::interval
  `;
  return result.count ?? 0;
};

export const execute = async (params: {
  automationId: string;
  triggerKind: "manual" | "schedule" | "event";
  eventName?: string;
  triggerDetails?: Record<string, unknown>;
  reason?: string;
  actorId?: string | null;
  input?: unknown | null;
  subject?: AutomationSubject;
  slotTs?: number;
}): Promise<Result<AutomationRun>> => {
  const automation = await getWithSecret(params.automationId);
  if (!automation) return fail(err.notFound("automation"));
  // Manual runs intentionally bypass `enabled`: admins can test a paused
  // automation without re-enabling scheduled/event triggers.
  if (!automation.enabled && params.triggerKind !== "manual") {
    return fail(err.badInput("automation is disabled"));
  }
  if (automation.action.kind !== "webhook") return fail(err.badInput("unsupported automation action"));

  const subject = params.subject ?? { type: "base" };
  const input = params.input === undefined ? null : params.input;
  const inputJson = JSON.stringify(input);
  if (inputJson.length > MAX_INPUT_BYTES) {
    return fail(err.badInput("automation input exceeds 64 KB"));
  }
  const recordResult = await resolveRecord(automation, subject);
  let recordForPayload: GridRecord | null;
  if (recordResult.ok) {
    recordForPayload = recordResult.data;
  } else if (params.eventName === "record.deleted" && subject.type === "record") {
    recordForPayload = null;
  } else {
    return fail(recordResult.error);
  }

  const target = await validateWebhookTarget(automation.action.url);
  if (!target.ok) return target;

  const event = eventFor(params.triggerKind, subject, params.eventName);
  const trigger = {
    kind: params.triggerKind,
    reason: params.reason ?? params.triggerKind,
    actorId: params.actorId ?? null,
    ...(params.slotTs ? { slotTs: params.slotTs } : {}),
    ...(params.triggerDetails ?? {}),
  };
  const targetHost = target.data.host;
  const [runRow] = await sql<DbRow[]>`
    INSERT INTO grids.automation_runs (
      automation_id, base_id, table_id, record_id, event, trigger, subject,
      input, status, target_host, started_at
    )
    VALUES (
      ${automation.id}::uuid,
      ${automation.baseId}::uuid,
      ${subject.type === "record" ? subject.tableId : null}::uuid,
      ${subject.type === "record" ? subject.recordId : null}::uuid,
      ${event},
      (${JSON.stringify(trigger)}::text)::jsonb,
      (${JSON.stringify(subject)}::text)::jsonb,
      (${inputJson}::text)::jsonb,
      'running',
      ${targetHost},
      now()
    )
    RETURNING ${RUN_COLS}
  `;
  if (!runRow) return fail(err.internal("automation run insert failed"));

  const runId = runRow.id as string;
  const body = JSON.stringify(
    buildPayload({
      automation,
      runId,
      event,
      trigger,
      subject,
      input,
      record: recordForPayload,
    }),
  );
  const timestamp = new Date().toISOString();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Grids-Automations/1.0",
    "X-Grids-Run-Id": runId,
    "X-Grids-Automation-Id": automation.id,
    "X-Grids-Event": event,
    "X-Grids-Idempotency-Key": params.triggerKind === "schedule" && params.slotTs ? `${automation.id}:${params.slotTs}` : runId,
    "X-Grids-Timestamp": timestamp,
  };
  if (automation.webhookSecret) {
    headers["X-Grids-Signature"] = buildWebhookSignature(automation.webhookSecret, timestamp, body);
  }

  const started = Date.now();
  let status: AutomationRun["status"] = "succeeded";
  let httpStatus: number | null = null;
  let errorMessage: string | null = null;
  try {
    const controller = new AbortController();
    const timeoutMs = Math.min(automation.action.timeoutMs ?? DEFAULT_WEBHOOK_TIMEOUT_MS, MAX_WEBHOOK_TIMEOUT_MS);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // External webhook target; typed Hono client only covers Grids API calls.
      const response = await fetch(automation.action.url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });
      httpStatus = response.status;
      if (response.status < 200 || response.status >= 300) {
        status = "failed";
        errorMessage = `Webhook returned HTTP ${response.status}`;
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    status = "failed";
    errorMessage = safeError(error);
  }

  const durationMs = Date.now() - started;
  const run = await sql.begin(async (tx) => {
    const [updatedRow] = await tx<DbRow[]>`
      UPDATE grids.automation_runs
      SET status = ${status},
          http_status = ${httpStatus},
          duration_ms = ${durationMs},
          error = ${errorMessage},
          finished_at = now()
      WHERE id = ${runId}::uuid
      RETURNING ${RUN_COLS}
    `;
    await logAudit(
      {
        baseId: automation.baseId,
        tableId: subject.type === "record" ? subject.tableId : null,
        recordId: subject.type === "record" ? subject.recordId : null,
        userId: params.actorId ?? null,
        action: status === "succeeded" ? "automation.webhook.sent" : "automation.webhook.failed",
        diff: {
          automation: {
            old: null,
            new: {
              automationId: automation.id,
              runId,
              event,
              triggerKind: params.triggerKind,
              targetHost,
              httpStatus,
              durationMs,
              status,
            },
          },
        },
      },
      tx,
    );
    return mapRunRow(updatedRow ?? runRow);
  });

  return ok(run);
};
