import { audit } from "@valentinkolb/cloud/services";
import { dates, err, fail, isServiceError, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import {
  type CreateResponseSchedule,
  type ResponseScheduleDefinitionInput,
  responseScheduleDefinitionSchema,
  type UpdateResponseSchedule,
} from "../contracts";
import { validateResponseScheduleDefinition } from "../response-schedule-validation";
import { requireMailboxPermission } from "./access";
import { actorRefFromRequest, auditActorFromRequest, type MailRequestContext } from "./auth";
import { publishMailMailboxEvent } from "./events";

export type ResponseScheduleWindow = { start: string; end: string };
export type ResponseScheduleWeeklyWindow = ResponseScheduleWindow & { weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7 };
export type ResponseScheduleException = { date: string; closed: boolean; windows: ResponseScheduleWindow[] };

export type ResponseScheduleDefinition = {
  timeZone: string;
  activeRanges: Array<{ from: string; to: string | null }>;
  weeklyWindows: ResponseScheduleWeeklyWindow[];
  exceptions: ResponseScheduleException[];
};

export type ResponseScheduleEvaluation = {
  active: boolean;
  localDate: string;
  localTime: string;
  reason: "outside_active_range" | "holiday" | "exception" | "office_hours" | "outside_office_hours";
};

type SqlClient = typeof sql;
type ResponseScheduleActor = { kind: "user" | "service_account"; id: string };
type ResponseScheduleRow = {
  id: string;
  mailbox_id: string;
  name: string;
  definition: unknown;
  enabled: boolean;
  revision: string | number;
  created_at: Date | string;
  updated_at: Date | string;
};

export type ResponseSchedule = {
  id: string;
  mailboxId: string;
  name: string;
  definition: ResponseScheduleDefinition;
  enabled: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

const WEEKDAYS: Record<string, ResponseScheduleWeeklyWindow["weekday"]> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

const minuteOfDay = (value: string): number => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));

export const validateResponseSchedule = validateResponseScheduleDefinition;

const localParts = (instant: Date, timeZone: string): { date: string; time: string; weekday: ResponseScheduleWeeklyWindow["weekday"] } => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = WEEKDAYS[value("weekday")];
  if (!weekday) throw new Error("Could not resolve schedule weekday");
  return { date: `${value("year")}-${value("month")}-${value("day")}`, time: `${value("hour")}:${value("minute")}`, weekday };
};

const withinWindow = (time: string, window: ResponseScheduleWindow): boolean => {
  const minute = minuteOfDay(time);
  return minute >= minuteOfDay(window.start) && minute < minuteOfDay(window.end);
};

export const evaluateResponseSchedule = (schedule: ResponseScheduleDefinition, instant: Date): ResponseScheduleEvaluation => {
  const errors = validateResponseSchedule(schedule);
  if (errors.length > 0) throw new Error(errors.join("; "));
  if (!Number.isFinite(instant.getTime())) throw new Error("Schedule evaluation instant is invalid");
  const timeZone = dates.normalizeTimeZone(schedule.timeZone, "UTC");
  const local = localParts(instant, timeZone);
  const insideActiveRange =
    schedule.activeRanges.length === 0 ||
    schedule.activeRanges.some((range) => local.date >= range.from && (range.to === null || local.date <= range.to));
  if (!insideActiveRange) return { active: false, localDate: local.date, localTime: local.time, reason: "outside_active_range" };

  const exception = schedule.exceptions.find((item) => item.date === local.date);
  if (exception?.closed) return { active: false, localDate: local.date, localTime: local.time, reason: "holiday" };
  if (exception) {
    const active = exception.windows.some((window) => withinWindow(local.time, window));
    return { active, localDate: local.date, localTime: local.time, reason: active ? "exception" : "outside_office_hours" };
  }
  const active = schedule.weeklyWindows
    .filter((window) => window.weekday === local.weekday)
    .some((window) => withinWindow(local.time, window));
  return { active, localDate: local.date, localTime: local.time, reason: active ? "office_hours" : "outside_office_hours" };
};

const addCalendarDays = (date: string, days: number): string => {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days, 12)).toISOString().slice(0, 10);
};

export const nextResponseScheduleInstant = (schedule: ResponseScheduleDefinition, after: Date, maxDays = 366): Date | null => {
  const errors = validateResponseSchedule(schedule);
  if (errors.length > 0) throw new Error(errors.join("; "));
  if (!Number.isFinite(after.getTime())) throw new Error("Schedule search instant is invalid");
  const timeZone = dates.normalizeTimeZone(schedule.timeZone, "UTC");
  const initial = localParts(after, timeZone);
  for (let offset = 0; offset <= maxDays; offset += 1) {
    const date = addCalendarDays(initial.date, offset);
    const insideActiveRange =
      schedule.activeRanges.length === 0 ||
      schedule.activeRanges.some((range) => date >= range.from && (range.to === null || date <= range.to));
    if (!insideActiveRange) continue;
    const exception = schedule.exceptions.find((item) => item.date === date);
    if (exception?.closed) continue;
    const weekday = localParts(
      new Date(dates.zonedDateTimeToInstant(`${date}T12:00`, timeZone, { disambiguation: "compatible" })),
      timeZone,
    ).weekday;
    const windows = exception ? exception.windows : schedule.weeklyWindows.filter((window) => window.weekday === weekday);
    for (const window of [...windows].sort((left, right) => minuteOfDay(left.start) - minuteOfDay(right.start))) {
      const candidate = new Date(dates.zonedDateTimeToInstant(`${date}T${window.start}`, timeZone, { disambiguation: "compatible" }));
      if (candidate.getTime() <= after.getTime()) continue;
      if (evaluateResponseSchedule(schedule, candidate).active) return candidate;
    }
  }
  return null;
};

const scheduleColumns = sql`
  schedule.id, schedule.mailbox_id, schedule.name, schedule.definition,
  schedule.enabled, schedule.revision, schedule.created_at, schedule.updated_at
`;
const toIso = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();
const normalizeName = (value: string): string => value.trim().replace(/\s+/gu, " ");
export const decodeStoredResponseScheduleDefinition = (value: unknown): Result<ResponseScheduleDefinition> => {
  let source = value;
  if (typeof value === "string") {
    try {
      source = JSON.parse(value);
    } catch {
      return fail(err.internal("Stored response schedule definition is invalid"));
    }
  }
  const parsed = responseScheduleDefinitionSchema.safeParse(source);
  if (!parsed.success) return fail(err.internal("Stored response schedule definition is invalid"));
  const definition: ResponseScheduleDefinition = parsed.data;
  return validateResponseSchedule(definition).length === 0
    ? ok(definition)
    : fail(err.internal("Stored response schedule definition is invalid"));
};
const mapSchedule = (row: ResponseScheduleRow): Result<ResponseSchedule> => {
  const definition = decodeStoredResponseScheduleDefinition(row.definition);
  if (!definition.ok) return definition;
  return ok({
    id: row.id,
    mailboxId: row.mailbox_id,
    name: row.name,
    definition: definition.data,
    enabled: row.enabled,
    revision: Number(row.revision),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
};

const requestActor = (context: MailRequestContext): ResponseScheduleActor => {
  const actor = actorRefFromRequest(context);
  if (actor.kind === "user") return { kind: actor.kind, id: actor.userId };
  if (actor.kind === "service_account") return { kind: actor.kind, id: actor.serviceAccountId };
  throw new Error("Request actor cannot configure response schedules");
};

export const normalizeResponseScheduleDefinition = (definition: ResponseScheduleDefinitionInput): Result<ResponseScheduleDefinition> => {
  const normalized: ResponseScheduleDefinition = {
    timeZone: definition.timeZone.trim(),
    activeRanges: definition.activeRanges,
    weeklyWindows: definition.weeklyWindows,
    exceptions: definition.exceptions,
  };
  const errors = validateResponseSchedule(normalized);
  return errors.length === 0 ? ok(normalized) : fail(err.badInput(errors.join("; ")));
};

const databaseCode = (error: unknown): string | null => {
  const candidate = error as { code?: unknown; errno?: unknown } | null;
  return typeof candidate?.code === "string" ? candidate.code : typeof candidate?.errno === "string" ? candidate.errno : null;
};

const mutationFailure = (error: unknown, fallback: string): Result<never> => {
  if (isServiceError(error)) return fail(error);
  if (databaseCode(error) === "23505") return fail(err.conflict("Response schedule name already exists"));
  return fail(err.internal(fallback));
};

const lockMailboxAdmin = async (context: MailRequestContext, mailboxId: string, db: SqlClient): Promise<Result<void>> => {
  const [mailbox] = await db<{ id: string }[]>`
    SELECT id FROM mail.mailboxes
    WHERE id = ${mailboxId}::uuid AND deleted_at IS NULL
    FOR UPDATE
  `;
  if (!mailbox) return fail(err.notFound("Mailbox"));
  const allowed = await requireMailboxPermission(context, mailboxId, "admin", db);
  return allowed.ok ? ok() : allowed;
};

const insertScheduleActivity = async (params: {
  db: SqlClient;
  context: MailRequestContext;
  mailboxId: string;
  action: "response_schedule.created" | "response_schedule.updated";
  schedule: ResponseSchedule;
}): Promise<string> => {
  const actor = requestActor(params.context);
  const [activity] = await params.db<{ id: string | number }[]>`
    INSERT INTO mail.activity_events (
      mailbox_id, actor_kind, actor_id, action, outcome, target_type, target_id, metadata
    ) VALUES (
      ${params.mailboxId}::uuid,
      ${actor.kind},
      ${actor.id}::uuid,
      ${params.action},
      'confirmed',
      'response_schedule',
      ${params.schedule.id}::uuid,
      ${{ name: params.schedule.name, enabled: params.schedule.enabled, revision: params.schedule.revision }}::jsonb
    )
    RETURNING id
  `;
  if (!activity) throw new Error("Response schedule activity insert returned no row");
  return String(activity.id);
};

export const listResponseSchedules = async (context: MailRequestContext, mailboxId: string): Promise<Result<ResponseSchedule[]>> => {
  const allowed = await requireMailboxPermission(context, mailboxId, "read");
  if (!allowed.ok) return allowed;
  const rows = await sql<ResponseScheduleRow[]>`
    SELECT ${scheduleColumns}
    FROM mail.response_schedules schedule
    WHERE schedule.mailbox_id = ${mailboxId}::uuid
      AND NOT EXISTS (
        SELECT 1
        FROM mail.automatic_reply_configurations configuration
        WHERE configuration.mailbox_id = schedule.mailbox_id
          AND configuration.response_schedule_id = schedule.id
      )
    ORDER BY schedule.enabled DESC, schedule.normalized_name, schedule.id
  `;
  const schedules: ResponseSchedule[] = [];
  for (const row of rows) {
    const schedule = mapSchedule(row);
    if (!schedule.ok) return schedule;
    schedules.push(schedule.data);
  }
  return ok(schedules);
};

export const createResponseSchedule = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  input: CreateResponseSchedule;
}): Promise<Result<ResponseSchedule>> => {
  const definition = normalizeResponseScheduleDefinition(params.input.definition);
  if (!definition.ok) return definition;
  const name = normalizeName(params.input.name);
  const actor = requestActor(params.context);
  try {
    const result = await sql.begin(async (tx): Promise<Result<{ schedule: ResponseSchedule; activityId: string }>> => {
      const allowed = await lockMailboxAdmin(params.context, params.mailboxId, tx);
      if (!allowed.ok) return allowed;
      const [row] = await tx<ResponseScheduleRow[]>`
        INSERT INTO mail.response_schedules (
          mailbox_id, name, normalized_name, definition, enabled, created_by_actor_kind, created_by_actor_id
        ) VALUES (
          ${params.mailboxId}::uuid,
          ${name},
          lower(regexp_replace(${name}, '\\s+', ' ', 'g')),
          ${definition.data}::jsonb,
          ${params.input.enabled},
          ${actor.kind},
          ${actor.id}::uuid
        )
        RETURNING id, mailbox_id, name, definition, enabled, revision, created_at, updated_at
      `;
      if (!row) throw new Error("Response schedule insert returned no row");
      const mapped = mapSchedule(row);
      if (!mapped.ok) return mapped;
      const schedule = mapped.data;
      const activityId = await insertScheduleActivity({
        db: tx,
        context: params.context,
        mailboxId: params.mailboxId,
        action: "response_schedule.created",
        schedule,
      });
      await audit.record(
        {
          action: "mail.response_schedule.create",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "response_schedule", id: schedule.id, label: schedule.name },
          requestId: params.context.requestId,
          metadata: { mailboxId: params.mailboxId, enabled: schedule.enabled, revision: schedule.revision },
        },
        tx,
      );
      return ok({ schedule, activityId });
    });
    if (!result.ok) return result;
    await publishMailMailboxEvent({
      mailboxId: params.mailboxId,
      conversationId: null,
      reason: "response_schedule",
      targetId: result.data.schedule.id,
      activityId: result.data.activityId,
    });
    return ok(result.data.schedule);
  } catch (error) {
    return mutationFailure(error, "Failed to create response schedule");
  }
};

export const updateResponseSchedule = async (params: {
  context: MailRequestContext;
  mailboxId: string;
  scheduleId: string;
  input: UpdateResponseSchedule;
}): Promise<Result<ResponseSchedule>> => {
  const definition = params.input.definition ? normalizeResponseScheduleDefinition(params.input.definition) : null;
  if (definition && !definition.ok) return definition;
  try {
    const result = await sql.begin(async (tx): Promise<Result<{ schedule: ResponseSchedule; activityId: string | null }>> => {
      const allowed = await lockMailboxAdmin(params.context, params.mailboxId, tx);
      if (!allowed.ok) return allowed;
      const [current] = await tx<ResponseScheduleRow[]>`
        SELECT ${scheduleColumns}
        FROM mail.response_schedules schedule
        WHERE schedule.id = ${params.scheduleId}::uuid AND schedule.mailbox_id = ${params.mailboxId}::uuid
        FOR UPDATE
      `;
      if (!current) return fail(err.notFound("Response schedule"));
      const [managed] = await tx<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1
          FROM mail.automatic_reply_configurations
          WHERE mailbox_id = ${params.mailboxId}::uuid
            AND response_schedule_id = ${params.scheduleId}::uuid
        ) AS exists
      `;
      if (managed?.exists) return fail(err.conflict("Managed automatic reply schedules must be changed from Automatic replies"));
      if (Number(current.revision) !== params.input.expectedRevision) return fail(err.conflict("Response schedule was changed"));
      const currentDefinition = decodeStoredResponseScheduleDefinition(current.definition);
      if (!currentDefinition.ok) return currentDefinition;
      const name = params.input.name === undefined ? current.name : normalizeName(params.input.name);
      const nextDefinition = definition?.ok ? definition.data : currentDefinition.data;
      const enabled = params.input.enabled ?? current.enabled;
      const changed =
        name !== current.name || enabled !== current.enabled || JSON.stringify(nextDefinition) !== JSON.stringify(currentDefinition.data);
      if (!changed) {
        const mapped = mapSchedule(current);
        return mapped.ok ? ok({ schedule: mapped.data, activityId: null }) : mapped;
      }
      const [updated] = await tx<ResponseScheduleRow[]>`
        UPDATE mail.response_schedules schedule
        SET
          name = ${name},
          normalized_name = lower(regexp_replace(${name}, '\\s+', ' ', 'g')),
          definition = ${nextDefinition}::jsonb,
          enabled = ${enabled},
          revision = revision + 1
        WHERE schedule.id = ${params.scheduleId}::uuid
        RETURNING schedule.id, schedule.mailbox_id, schedule.name, schedule.definition,
          schedule.enabled, schedule.revision, schedule.created_at, schedule.updated_at
      `;
      if (!updated) throw new Error("Response schedule update returned no row");
      const mapped = mapSchedule(updated);
      if (!mapped.ok) return mapped;
      const schedule = mapped.data;
      const activityId = await insertScheduleActivity({
        db: tx,
        context: params.context,
        mailboxId: params.mailboxId,
        action: "response_schedule.updated",
        schedule,
      });
      await audit.record(
        {
          action: "mail.response_schedule.update",
          outcome: "allowed",
          actor: auditActorFromRequest(params.context),
          target: { type: "response_schedule", id: schedule.id, label: schedule.name },
          requestId: params.context.requestId,
          metadata: { mailboxId: params.mailboxId, enabled: schedule.enabled, revision: schedule.revision },
        },
        tx,
      );
      return ok({ schedule, activityId });
    });
    if (!result.ok) return result;
    if (result.data.activityId) {
      await publishMailMailboxEvent({
        mailboxId: params.mailboxId,
        conversationId: null,
        reason: "response_schedule",
        targetId: result.data.schedule.id,
        activityId: result.data.activityId,
      });
    }
    return ok(result.data.schedule);
  } catch (error) {
    return mutationFailure(error, "Failed to update response schedule");
  }
};

export const evaluateNamedResponseSchedule = async (params: {
  mailboxId: string;
  scheduleId: string;
  instant: Date;
  db?: SqlClient;
}): Promise<Result<{ schedule: ResponseSchedule; evaluation: ResponseScheduleEvaluation }>> => {
  const db = params.db ?? sql;
  const [row] = await db<ResponseScheduleRow[]>`
    SELECT ${scheduleColumns}
    FROM mail.response_schedules schedule
    WHERE schedule.id = ${params.scheduleId}::uuid
      AND schedule.mailbox_id = ${params.mailboxId}::uuid
      AND schedule.enabled
  `;
  if (!row) return fail(err.badInput("Response schedule is unavailable"));
  const schedule = mapSchedule(row);
  if (!schedule.ok) return schedule;
  return ok({ schedule: schedule.data, evaluation: evaluateResponseSchedule(schedule.data.definition, params.instant) });
};
