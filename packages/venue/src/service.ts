import {
  type AccessEntry,
  createAccess,
  deleteAccess,
  err,
  fail,
  getEffectivePermission,
  hasPermission,
  ok,
  type PermissionLevel,
  type Principal,
  type Result,
  resolveDisplayNames,
  updateAccess,
} from "@valentinkolb/cloud/server";
import { logger } from "@valentinkolb/cloud/services";
import { dates } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type { z } from "zod";
import type {
  DateOverride,
  DateOverrideInput,
  FeedbackEntry,
  FeedbackInputSchema,
  FeedbackSummary,
  FreeSignupInputSchema,
  OpeningRule,
  OpeningRuleInput,
  PublicSection,
  PublicSectionInput,
  PublicStatus,
  ShiftAssignment,
  ShiftTemplate,
  ShiftTemplateInput,
  TemplateSignupInputSchema,
  UpcomingSlot,
  Venue,
  VenueDashboard,
  VenueInput,
  VenueTemplateCreateInput,
  VenueTemplateSummary,
} from "./contracts";
import { getVenueTemplate, templates as venueTemplates } from "./templates";

const log = logger("venue:service");

type DbVenue = {
  id: string;
  slug: string;
  name: string;
  icon: string;
  description: string | null;
  timezone: string;
  open_mode: Venue["openMode"];
  signup_mode: Venue["signupMode"];
  public_enabled: boolean;
  feedback_enabled: boolean;
  accent_color: string;
  logo_base64: string | null;
  banner_base64: string | null;
  ical_token: string;
  created_at: Date;
  updated_at: Date;
};

type DbOpeningRule = {
  id: string;
  venue_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  note: string | null;
  position: number;
  created_at: Date;
  updated_at: Date;
};

type DbDateOverride = {
  id: string;
  venue_id: string;
  date: string | Date;
  kind: "closed" | "open";
  start_time: string | null;
  end_time: string | null;
  note: string | null;
  created_at: Date;
  updated_at: Date;
};

type DbShiftTemplate = {
  id: string;
  venue_id: string;
  weekday: number;
  title: string;
  start_time: string;
  end_time: string;
  min_people: number;
  max_people: number | null;
  active: boolean;
  created_at: Date;
  updated_at: Date;
};

type DbShiftAssignment = {
  id: string;
  venue_id: string;
  template_id: string | null;
  user_id: string;
  user_display_name: string | null;
  starts_at: Date;
  ends_at: Date;
  note: string | null;
  created_at: Date;
  updated_at: Date;
};

type DbPublicSection = {
  id: string;
  venue_id: string;
  kind: PublicSection["kind"];
  title: string;
  content: Record<string, unknown> | string | null;
  enabled: boolean;
  position: number;
  created_at: Date;
  updated_at: Date;
};

type DbFeedbackEntry = {
  id: string;
  venue_id: string;
  rating: number;
  comment: string | null;
  created_at: Date;
};

type UserLike = {
  id: string;
  memberofGroupIds?: unknown;
};

type ResultError = Extract<Result<unknown>, { ok: false }>["error"];

class TemplateError extends Error {
  constructor(public readonly resultError: ResultError) {
    super(resultError.message);
  }
}

const userGroupIds = (user: UserLike): string[] => (Array.isArray(user.memberofGroupIds) ? user.memberofGroupIds : []);

const toDateKey = (value: string | Date): string => {
  if (value instanceof Date) return dates.formatDateKey(value, { timeZone: "UTC" });
  return value.slice(0, 10);
};

const toTime = (value: string | null): string | null => (value ? value.slice(0, 5) : null);

const mapVenue = (row: DbVenue, permission?: PermissionLevel): Venue => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  icon: row.icon || "ti ti-building-carousel",
  description: row.description,
  timezone: row.timezone,
  openMode: row.open_mode,
  signupMode: row.signup_mode,
  publicEnabled: row.public_enabled,
  feedbackEnabled: row.feedback_enabled,
  accentColor: row.accent_color,
  logoBase64: row.logo_base64,
  bannerBase64: row.banner_base64,
  icalToken: row.ical_token,
  permission,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const mapOpeningRule = (row: DbOpeningRule): OpeningRule => ({
  id: row.id,
  venueId: row.venue_id,
  weekday: row.weekday,
  startTime: toTime(row.start_time) ?? "00:00",
  endTime: toTime(row.end_time) ?? "00:00",
  note: row.note,
  position: row.position,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const mapOverride = (row: DbDateOverride): DateOverride => ({
  id: row.id,
  venueId: row.venue_id,
  date: toDateKey(row.date),
  kind: row.kind,
  startTime: toTime(row.start_time),
  endTime: toTime(row.end_time),
  note: row.note,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const mapTemplate = (row: DbShiftTemplate): ShiftTemplate => ({
  id: row.id,
  venueId: row.venue_id,
  weekday: row.weekday,
  title: row.title,
  startTime: toTime(row.start_time) ?? "00:00",
  endTime: toTime(row.end_time) ?? "00:00",
  minPeople: row.min_people,
  maxPeople: row.max_people,
  active: row.active,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const mapAssignment = (row: DbShiftAssignment): ShiftAssignment => ({
  id: row.id,
  venueId: row.venue_id,
  templateId: row.template_id,
  userId: row.user_id,
  userDisplayName: row.user_display_name ?? "Unknown user",
  startsAt: row.starts_at.toISOString(),
  endsAt: row.ends_at.toISOString(),
  note: row.note,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const mapSection = (row: DbPublicSection): PublicSection => ({
  id: row.id,
  venueId: row.venue_id,
  kind: row.kind,
  title: row.title,
  content: typeof row.content === "string" ? (JSON.parse(row.content) as Record<string, unknown>) : (row.content ?? {}),
  enabled: row.enabled,
  position: row.position,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const mapFeedback = (row: DbFeedbackEntry): FeedbackEntry => ({
  id: row.id,
  venueId: row.venue_id,
  rating: row.rating,
  comment: row.comment,
  createdAt: row.created_at.toISOString(),
});

const slugify = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "venue";

const resolveAvailableVenueSlug = async (baseSlug: string): Promise<string> => {
  const base = slugify(baseSlug);
  const rows = await sql<{ slug: string }[]>`
    SELECT slug FROM venue.venues
    WHERE slug = ${base} OR slug LIKE ${`${base}-%`}
  `;
  const existing = new Set(rows.map((row) => row.slug));
  if (!existing.has(base)) return base;

  for (let suffix = 2; suffix < 10_000; suffix++) {
    const suffixPart = `-${suffix}`;
    const candidate = `${base.slice(0, 80 - suffixPart.length)}${suffixPart}`;
    if (!existing.has(candidate)) return candidate;
  }

  return `${base.slice(0, 67)}-${crypto.randomUUID().slice(0, 12)}`;
};

const localDateKey = (instant: Date, timezone: string): string => dates.formatDateKey(instant, { timeZone: timezone });

const localWeekday = (dateKey: string): number => {
  const day = new Date(`${dateKey}T12:00:00Z`).getUTCDay();
  return day === 0 ? 0 : day;
};

const localTime = (instant: Date, timezone: string): string => dates.instantToZonedInput(instant, timezone).slice(11, 16);

const instantFor = (date: string, time: string, timezone: string): Date =>
  new Date(dates.zonedDateTimeToInstant(`${date}T${time}`, timezone, { disambiguation: "compatible" }));

const dateKeyAfterDays = (date: string, days: number, timezone: string): string =>
  dates.formatDateKey(new Date(instantFor(date, "12:00", timezone).getTime() + days * 86_400_000), { timeZone: timezone });

const formatDateTime = (iso: string | Date, timezone: string): string =>
  new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(typeof iso === "string" ? new Date(iso) : iso);

const formatWindow = (start: string, end: string): string => `${start}-${end}`;

const escapeIcs = (value: string): string => value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");

const icsDate = (date: Date): string =>
  date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

export const listAccess = async (venueId: string): Promise<AccessEntry[]> => {
  const rows = await sql<
    {
      access_id: string;
      user_id: string | null;
      group_id: string | null;
      authenticated_only: boolean;
      permission: PermissionLevel;
      created_at: Date;
    }[]
  >`
    SELECT a.id AS access_id, a.user_id, a.group_id, a.authenticated_only, a.permission, a.created_at
    FROM venue.venue_access va
    JOIN auth.access a ON a.id = va.access_id
    WHERE va.venue_id = ${venueId}::uuid
    ORDER BY a.created_at
  `;

  return resolveDisplayNames(
    rows.map((row) => ({
      id: row.access_id,
      principal: row.user_id
        ? { type: "user", userId: row.user_id }
        : row.group_id
          ? { type: "group", groupId: row.group_id }
          : row.authenticated_only
            ? { type: "authenticated" }
            : { type: "public" },
      permission: row.permission,
      createdAt: row.created_at.toISOString(),
    })),
  );
};

export const getPermission = async (venueId: string, user: UserLike): Promise<PermissionLevel> => {
  const entries = await listAccess(venueId);
  return getEffectivePermission({
    accessIds: entries.map((entry) => entry.id),
    userId: user.id,
    userGroups: userGroupIds(user),
  });
};

export const requirePermission = async (venueId: string, user: UserLike, required: PermissionLevel): Promise<Result<PermissionLevel>> => {
  const permission = await getPermission(venueId, user);
  if (!hasPermission(permission, required)) return fail(err.forbidden("You do not have access to this venue"));
  return ok(permission);
};

export const listVenues = async (user: UserLike): Promise<Venue[]> => {
  const rows = await sql<DbVenue[]>`
    SELECT DISTINCT v.*
    FROM venue.venues v
    JOIN venue.venue_access va ON va.venue_id = v.id
    JOIN auth.access a ON a.id = va.access_id
    WHERE
      a.permission <> 'none'
      AND (
        a.user_id = ${user.id}::uuid
        OR a.authenticated_only = true
        OR a.group_id = ANY(${`{${userGroupIds(user).join(",")}}`}::uuid[])
      )
    ORDER BY v.name
  `;

  const venues: Venue[] = [];
  for (const row of rows) {
    venues.push(mapVenue(row, await getPermission(row.id, user)));
  }
  return venues;
};

export const getVenue = async (id: string, user?: UserLike): Promise<Venue | null> => {
  const [row] = await sql<DbVenue[]>`SELECT * FROM venue.venues WHERE id = ${id}::uuid`;
  if (!row) return null;
  return mapVenue(row, user ? await getPermission(row.id, user) : undefined);
};

export const getVenueBySlug = async (slug: string): Promise<Venue | null> => {
  const [row] = await sql<DbVenue[]>`SELECT * FROM venue.venues WHERE slug = ${slug}`;
  return row ? mapVenue(row) : null;
};

export const createVenue = async (input: VenueInput, user: UserLike): Promise<Result<Venue>> => {
  return sql.begin(async (tx) => {
    const [row] = await tx<DbVenue[]>`
      INSERT INTO venue.venues (
        slug, name, icon, description, timezone, open_mode, signup_mode, public_enabled,
        feedback_enabled, accent_color, logo_base64, banner_base64
      )
      VALUES (
        ${slugify(input.slug)}, ${input.name.trim()}, ${input.icon || "ti ti-building-carousel"}, ${input.description?.trim() || null},
        ${input.timezone || "Europe/Berlin"}, ${input.openMode}, ${input.signupMode},
        ${input.publicEnabled}, ${input.feedbackEnabled}, ${input.accentColor},
        ${input.logoBase64 || null}, ${input.bannerBase64 || null}
      )
      RETURNING *
    `;
    if (!row) return fail(err.internal("Failed to create venue"));

    const access = await createAccess({ principal: { type: "user", userId: user.id }, permission: "admin" });
    if (!access.ok) return access;

    await tx`
      INSERT INTO venue.venue_access (venue_id, access_id)
      VALUES (${row.id}::uuid, ${access.data.id}::uuid)
    `;
    log.info("Venue created", { venueId: row.id, userId: user.id });
    return ok(mapVenue(row, "admin"));
  });
};

export const listVenueTemplates = (): VenueTemplateSummary[] =>
  venueTemplates.map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description,
    icon: template.icon,
  }));

const requireTemplateResult = <T>(result: Result<T>): T => {
  if (!result.ok) throw new TemplateError(result.error);
  return result.data;
};

export const instantiateVenueTemplate = async (
  templateId: string,
  input: VenueTemplateCreateInput,
  user: UserLike,
): Promise<Result<Venue>> => {
  const template = getVenueTemplate(templateId);
  if (!template) return fail(err.notFound("Template"));

  const name = input.name?.trim() || template.venue.name;
  const venue = await createVenue(
    {
      ...template.venue,
      name,
      slug: await resolveAvailableVenueSlug(input.slug?.trim() || name || template.venue.slug),
    },
    user,
  );
  if (!venue.ok) return venue;

  try {
    for (const rule of template.openingRules) {
      requireTemplateResult(await createOpeningRule(venue.data.id, rule));
    }
    for (const shift of template.shifts) {
      requireTemplateResult(await createTemplate(venue.data.id, shift));
    }
    for (const [index, section] of template.sections.entries()) {
      requireTemplateResult(await createSection(venue.data.id, { ...section, position: index + 1 }));
    }
    return venue;
  } catch (error) {
    await sql`DELETE FROM venue.venues WHERE id = ${venue.data.id}::uuid`.catch(() => {});
    log.error("Venue template instantiation failed", {
      templateId,
      venueId: venue.data.id,
      error: error instanceof Error ? error.message : String(error),
    });
    if (error instanceof TemplateError) return fail(error.resultError);
    return fail(err.internal("Could not create venue from template."));
  }
};

export const updateVenue = async (id: string, input: VenueInput): Promise<Result<Venue>> => {
  const [row] = await sql<DbVenue[]>`
    UPDATE venue.venues
    SET
      slug = ${slugify(input.slug)},
      name = ${input.name.trim()},
      icon = ${input.icon || "ti ti-building-carousel"},
      description = ${input.description?.trim() || null},
      timezone = ${input.timezone || "Europe/Berlin"},
      open_mode = ${input.openMode},
      signup_mode = ${input.signupMode},
      public_enabled = ${input.publicEnabled},
      feedback_enabled = ${input.feedbackEnabled},
      accent_color = ${input.accentColor},
      logo_base64 = ${input.logoBase64 || null},
      banner_base64 = ${input.bannerBase64 || null},
      updated_at = now()
    WHERE id = ${id}::uuid
    RETURNING *
  `;
  return row ? ok(mapVenue(row)) : fail(err.notFound("Venue"));
};

export const grantAccess = async (venueId: string, principal: Principal, permission: PermissionLevel): Promise<Result<AccessEntry>> => {
  const existing = await listAccess(venueId);
  const duplicate = existing.find((entry) => JSON.stringify(entry.principal) === JSON.stringify(principal));
  if (duplicate) return fail(err.conflict("Access entry"));

  const created = await createAccess({ principal, permission });
  if (!created.ok) return created;

  try {
    await sql`INSERT INTO venue.venue_access (venue_id, access_id) VALUES (${venueId}::uuid, ${created.data.id}::uuid)`;
  } catch (error) {
    await deleteAccess({ id: created.data.id });
    throw error;
  }

  const entries = await listAccess(venueId);
  const entry = entries.find((candidate) => candidate.id === created.data.id);
  return entry ? ok(entry) : fail(err.internal("Failed to retrieve access entry"));
};

export const changeAccess = async (venueId: string, accessId: string, permission: PermissionLevel): Promise<Result<AccessEntry>> => {
  const entries = await listAccess(venueId);
  if (!entries.some((entry) => entry.id === accessId)) return fail(err.notFound("Access entry"));
  const updated = await updateAccess({ id: accessId, permission });
  if (!updated.ok) return updated;
  const next = await listAccess(venueId);
  const entry = next.find((candidate) => candidate.id === accessId);
  return entry ? ok(entry) : fail(err.internal("Failed to retrieve access entry"));
};

export const revokeAccess = async (venueId: string, accessId: string): Promise<Result<void>> => {
  const entries = await listAccess(venueId);
  const target = entries.find((entry) => entry.id === accessId);
  if (!target) return fail(err.notFound("Access entry"));
  const remainingAdmins = entries.filter((entry) => entry.id !== accessId && entry.permission === "admin").length;
  if (target.permission === "admin" && remainingAdmins === 0) return fail(err.badInput("A venue needs at least one admin"));
  await deleteAccess({ id: accessId });
  return ok();
};

export const listOpeningRules = async (venueId: string): Promise<OpeningRule[]> => {
  const rows = await sql<DbOpeningRule[]>`
    SELECT * FROM venue.opening_rules
    WHERE venue_id = ${venueId}::uuid
    ORDER BY weekday, start_time
  `;
  return rows.map(mapOpeningRule);
};

export const createOpeningRule = async (venueId: string, input: OpeningRuleInput): Promise<Result<OpeningRule>> => {
  const [row] = await sql<DbOpeningRule[]>`
    INSERT INTO venue.opening_rules (venue_id, weekday, start_time, end_time, note)
    VALUES (${venueId}::uuid, ${input.weekday}, ${input.startTime}::time, ${input.endTime}::time, ${input.note?.trim() || null})
    RETURNING *
  `;
  return row ? ok(mapOpeningRule(row)) : fail(err.internal("Failed to create opening rule"));
};

export const updateOpeningRule = async (venueId: string, id: string, input: OpeningRuleInput): Promise<Result<OpeningRule>> => {
  const [row] = await sql<DbOpeningRule[]>`
    UPDATE venue.opening_rules
    SET weekday = ${input.weekday},
        start_time = ${input.startTime}::time,
        end_time = ${input.endTime}::time,
        note = ${input.note?.trim() || null},
        updated_at = now()
    WHERE venue_id = ${venueId}::uuid AND id = ${id}::uuid
    RETURNING *
  `;
  return row ? ok(mapOpeningRule(row)) : fail(err.notFound("Opening rule"));
};

export const deleteOpeningRule = async (venueId: string, id: string): Promise<Result<void>> => {
  await sql`DELETE FROM venue.opening_rules WHERE venue_id = ${venueId}::uuid AND id = ${id}::uuid`;
  return ok();
};

export const listOverrides = async (venueId: string, days = 60): Promise<DateOverride[]> => {
  const rows = await sql<DbDateOverride[]>`
    SELECT * FROM venue.date_overrides
    WHERE venue_id = ${venueId}::uuid
      AND date >= CURRENT_DATE - INTERVAL '7 days'
      AND date <= CURRENT_DATE + (${days}::int * INTERVAL '1 day')
    ORDER BY date
  `;
  return rows.map(mapOverride);
};

export const upsertOverride = async (venueId: string, input: DateOverrideInput): Promise<Result<DateOverride>> => {
  const [row] = await sql<DbDateOverride[]>`
    INSERT INTO venue.date_overrides (venue_id, date, kind, start_time, end_time, note)
    VALUES (
      ${venueId}::uuid, ${input.date}::date, ${input.kind},
      ${input.kind === "open" ? input.startTime : null}::time,
      ${input.kind === "open" ? input.endTime : null}::time,
      ${input.note?.trim() || null}
    )
    ON CONFLICT (venue_id, date)
    DO UPDATE SET kind = EXCLUDED.kind, start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, note = EXCLUDED.note, updated_at = now()
    RETURNING *
  `;
  return row ? ok(mapOverride(row)) : fail(err.internal("Failed to save override"));
};

export const updateOverride = async (venueId: string, id: string, input: DateOverrideInput): Promise<Result<DateOverride>> => {
  const [row] = await sql<DbDateOverride[]>`
    UPDATE venue.date_overrides
    SET date = ${input.date}::date,
        kind = ${input.kind},
        start_time = ${input.kind === "open" ? input.startTime : null}::time,
        end_time = ${input.kind === "open" ? input.endTime : null}::time,
        note = ${input.note?.trim() || null},
        updated_at = now()
    WHERE venue_id = ${venueId}::uuid AND id = ${id}::uuid
    RETURNING *
  `;
  return row ? ok(mapOverride(row)) : fail(err.notFound("Date override"));
};

export const deleteOverride = async (venueId: string, id: string): Promise<Result<void>> => {
  await sql`DELETE FROM venue.date_overrides WHERE venue_id = ${venueId}::uuid AND id = ${id}::uuid`;
  return ok();
};

export const listTemplates = async (venueId: string): Promise<ShiftTemplate[]> => {
  const rows = await sql<DbShiftTemplate[]>`
    SELECT * FROM venue.shift_templates
    WHERE venue_id = ${venueId}::uuid
    ORDER BY weekday, start_time
  `;
  return rows.map(mapTemplate);
};

export const createTemplate = async (venueId: string, input: ShiftTemplateInput): Promise<Result<ShiftTemplate>> => {
  const [row] = await sql<DbShiftTemplate[]>`
    INSERT INTO venue.shift_templates (venue_id, weekday, title, start_time, end_time, min_people, max_people, active)
    VALUES (
      ${venueId}::uuid, ${input.weekday}, ${input.title.trim()}, ${input.startTime}::time, ${input.endTime}::time,
      ${input.minPeople}, ${input.maxPeople ?? null}, ${input.active}
    )
    RETURNING *
  `;
  return row ? ok(mapTemplate(row)) : fail(err.internal("Failed to create shift"));
};

export const updateTemplate = async (venueId: string, id: string, input: ShiftTemplateInput): Promise<Result<ShiftTemplate>> => {
  const [row] = await sql<DbShiftTemplate[]>`
    UPDATE venue.shift_templates
    SET weekday = ${input.weekday},
        title = ${input.title.trim()},
        start_time = ${input.startTime}::time,
        end_time = ${input.endTime}::time,
        min_people = ${input.minPeople},
        max_people = ${input.maxPeople ?? null},
        active = ${input.active},
        updated_at = now()
    WHERE venue_id = ${venueId}::uuid AND id = ${id}::uuid
    RETURNING *
  `;
  return row ? ok(mapTemplate(row)) : fail(err.notFound("Shift"));
};

export const deleteTemplate = async (venueId: string, id: string): Promise<Result<void>> => {
  await sql`UPDATE venue.shift_templates SET active = false, updated_at = now() WHERE venue_id = ${venueId}::uuid AND id = ${id}::uuid`;
  return ok();
};

const assignmentsForRange = async (venueId: string, start: Date, end: Date): Promise<ShiftAssignment[]> => {
  const rows = await sql<DbShiftAssignment[]>`
    SELECT sa.*, u.display_name AS user_display_name
    FROM venue.shift_assignments sa
    JOIN auth.users u ON u.id = sa.user_id
    WHERE sa.venue_id = ${venueId}::uuid
      AND sa.starts_at < ${end}
      AND sa.ends_at > ${start}
    ORDER BY sa.starts_at, u.display_name
  `;
  return rows.map(mapAssignment);
};

type UpcomingSlotsOptions = {
  startDate?: string;
  days?: number;
  templates?: ShiftTemplate[];
};

export const upcomingSlots = async (venue: Venue, options: number | UpcomingSlotsOptions = 14): Promise<UpcomingSlot[]> => {
  const config = typeof options === "number" ? { days: options } : options;
  const days = Math.max(0, config.days ?? 14);
  if (days === 0) return [];

  const templates = (config.templates ?? (await listTemplates(venue.id))).filter((template) => template.active);
  if (templates.length === 0) return [];

  const startDate = config.startDate ?? localDateKey(new Date(), venue.timezone);
  const rangeStart = instantFor(startDate, "00:00", venue.timezone);
  const rangeEnd = new Date(rangeStart.getTime() + days * 86_400_000);
  const assignments = await assignmentsForRange(venue.id, rangeStart, rangeEnd);

  const templatesByWeekday = new Map<number, ShiftTemplate[]>();
  for (const template of templates) {
    const entries = templatesByWeekday.get(template.weekday);
    if (entries) entries.push(template);
    else templatesByWeekday.set(template.weekday, [template]);
  }

  const assignmentsBySlot = new Map<string, ShiftAssignment[]>();
  for (const assignment of assignments) {
    if (!assignment.templateId) continue;
    const key = `${assignment.templateId}:${assignment.startsAt}`;
    const entries = assignmentsBySlot.get(key);
    if (entries) entries.push(assignment);
    else assignmentsBySlot.set(key, [assignment]);
  }

  const slots: UpcomingSlot[] = [];
  for (let offset = 0; offset < days; offset++) {
    const date = dateKeyAfterDays(startDate, offset, venue.timezone);
    const weekdayTemplates = templatesByWeekday.get(localWeekday(date));
    if (!weekdayTemplates) continue;

    for (const template of weekdayTemplates) {
      const startsAt = instantFor(date, template.startTime, venue.timezone).toISOString();
      const endsAt = instantFor(date, template.endTime, venue.timezone).toISOString();
      const slotAssignments = assignmentsBySlot.get(`${template.id}:${startsAt}`) ?? [];
      const assignedCount = slotAssignments.length;
      slots.push({
        key: `${template.id}:${date}`,
        date,
        template,
        startsAt,
        endsAt,
        assignedCount,
        minPeople: template.minPeople,
        maxPeople: template.maxPeople,
        missingPeople: Math.max(0, template.minPeople - assignedCount),
        full: template.maxPeople !== null && assignedCount >= template.maxPeople,
        assignments: slotAssignments,
      });
    }
  }
  return slots;
};

export const signupTemplate = async (
  venue: Venue,
  templateId: string,
  input: z.infer<typeof TemplateSignupInputSchema>,
  user: UserLike,
): Promise<Result<ShiftAssignment>> => {
  const [template] = await sql<DbShiftTemplate[]>`
    SELECT * FROM venue.shift_templates
    WHERE id = ${templateId}::uuid AND venue_id = ${venue.id}::uuid AND active = true
  `;
  if (!template) return fail(err.notFound("Shift"));

  const start = instantFor(input.date, toTime(template.start_time) ?? "00:00", venue.timezone);
  const end = instantFor(input.date, toTime(template.end_time) ?? "00:00", venue.timezone);
  if (end < new Date()) return fail(err.badInput("This shift has already ended"));

  const [row] = await sql<DbShiftAssignment[]>`
    INSERT INTO venue.shift_assignments (venue_id, template_id, user_id, starts_at, ends_at)
    SELECT ${venue.id}::uuid, t.id, ${user.id}::uuid, ${start}, ${end}
    FROM venue.shift_templates t
    WHERE t.id = ${templateId}::uuid
      AND t.venue_id = ${venue.id}::uuid
      AND t.active = true
      AND (
        t.max_people IS NULL
        OR (
          SELECT COUNT(*)::int
          FROM venue.shift_assignments sa
          WHERE sa.template_id = t.id AND sa.starts_at = ${start}
        ) < t.max_people
      )
    RETURNING *, NULL::text AS user_display_name
  `;
  if (!row) return fail(err.badInput("This shift is already full"));
  return ok((await assignmentsForRange(venue.id, start, end)).find((entry) => entry.id === row.id) ?? mapAssignment(row));
};

export const signupTemplateWeeks = async (
  venue: Venue,
  templateId: string,
  date: string,
  weeks: number,
  user: UserLike,
): Promise<Result<ShiftAssignment[]>> => {
  const created: ShiftAssignment[] = [];
  for (let week = 0; week < weeks; week++) {
    const nextDate = dates.formatDateKey(new Date(instantFor(date, "12:00", venue.timezone).getTime() + week * 7 * 86_400_000), {
      timeZone: venue.timezone,
    });
    const result = await signupTemplate(venue, templateId, { date: nextDate }, user);
    if (result.ok) created.push(result.data);
  }
  return ok(created);
};

export const signupFree = async (
  venueId: string,
  input: z.infer<typeof FreeSignupInputSchema>,
  user: UserLike,
): Promise<Result<ShiftAssignment>> => {
  const start = new Date(input.startsAt);
  const end = new Date(input.endsAt);
  if (!(start < end)) return fail(err.badInput("Start must be before end"));
  if (end < new Date()) return fail(err.badInput("This shift has already ended"));

  const [row] = await sql<DbShiftAssignment[]>`
    INSERT INTO venue.shift_assignments (venue_id, user_id, starts_at, ends_at, note)
    VALUES (${venueId}::uuid, ${user.id}::uuid, ${start}, ${end}, ${input.note?.trim() || null})
    RETURNING *, NULL::text AS user_display_name
  `;
  return row
    ? ok((await assignmentsForRange(venueId, start, end)).find((entry) => entry.id === row.id) ?? mapAssignment(row))
    : fail(err.internal("Failed to sign up"));
};

export const cancelAssignment = async (venueId: string, assignmentId: string, user: UserLike, canAdmin: boolean): Promise<Result<void>> => {
  const rows = await sql<{ user_id: string }[]>`
    DELETE FROM venue.shift_assignments
    WHERE venue_id = ${venueId}::uuid
      AND id = ${assignmentId}::uuid
      AND (${canAdmin} OR user_id = ${user.id}::uuid)
    RETURNING user_id
  `;
  return rows.length > 0 ? ok() : fail(err.notFound("Shift assignment"));
};

export const listSections = async (venueId: string, onlyEnabled = false): Promise<PublicSection[]> => {
  const rows = await sql<DbPublicSection[]>`
    SELECT * FROM venue.public_sections
    WHERE venue_id = ${venueId}::uuid
      AND (${!onlyEnabled} OR enabled = true)
    ORDER BY position, created_at
  `;
  return rows.map(mapSection);
};

export const createSection = async (venueId: string, input: PublicSectionInput): Promise<Result<PublicSection>> => {
  const [row] = await sql<DbPublicSection[]>`
    INSERT INTO venue.public_sections (venue_id, kind, title, content, enabled, position)
    VALUES (${venueId}::uuid, ${input.kind}, ${input.title.trim()}, ${JSON.stringify(input.content)}::jsonb, ${input.enabled}, ${input.position})
    RETURNING *
  `;
  return row ? ok(mapSection(row)) : fail(err.internal("Failed to create public section"));
};

export const updateSection = async (venueId: string, id: string, input: PublicSectionInput): Promise<Result<PublicSection>> => {
  const [row] = await sql<DbPublicSection[]>`
    UPDATE venue.public_sections
    SET title = ${input.title.trim()},
        content = ${JSON.stringify(input.content)}::jsonb,
        enabled = ${input.enabled},
        position = ${input.position},
        updated_at = now()
    WHERE venue_id = ${venueId}::uuid AND id = ${id}::uuid
    RETURNING *
  `;
  return row ? ok(mapSection(row)) : fail(err.notFound("Public section"));
};

export const deleteSection = async (venueId: string, id: string): Promise<Result<void>> => {
  await sql`DELETE FROM venue.public_sections WHERE venue_id = ${venueId}::uuid AND id = ${id}::uuid`;
  return ok();
};

export const createFeedback = async (venueId: string, input: z.infer<typeof FeedbackInputSchema>): Promise<Result<FeedbackEntry>> => {
  const [venue] = await sql<{ feedback_enabled: boolean }[]>`SELECT feedback_enabled FROM venue.venues WHERE id = ${venueId}::uuid`;
  if (!venue?.feedback_enabled) return fail(err.badInput("Feedback is disabled for this venue"));
  const [row] = await sql<DbFeedbackEntry[]>`
    INSERT INTO venue.feedback_entries (venue_id, rating, comment)
    VALUES (${venueId}::uuid, ${input.rating}, ${input.comment?.trim() || null})
    RETURNING *
  `;
  return row ? ok(mapFeedback(row)) : fail(err.internal("Failed to submit feedback"));
};

export const feedbackSummary = async (
  venueId: string,
  options: { includeEntries?: boolean; entryDays?: number; entrySearch?: string } = {},
): Promise<{ summary: FeedbackSummary; entries: FeedbackEntry[] }> => {
  const [summary] = await sql<{ count: number; average_rating: number | null }[]>`
    SELECT COUNT(*)::int AS count, ROUND(AVG(rating)::numeric, 2)::float AS average_rating
    FROM venue.feedback_entries
    WHERE venue_id = ${venueId}::uuid
  `;
  const buckets = await sql<{ date: string | Date; count: number; average_rating: number | null }[]>`
    SELECT created_at::date AS date, COUNT(*)::int AS count, ROUND(AVG(rating)::numeric, 2)::float AS average_rating
    FROM venue.feedback_entries
    WHERE venue_id = ${venueId}::uuid
      AND created_at >= now() - INTERVAL '30 days'
    GROUP BY created_at::date
    ORDER BY created_at::date
  `;
  const entryDays = Math.max(1, Math.min(30, options.entryDays ?? 30));
  const entrySearch = options.entrySearch?.trim();
  const entries = options.includeEntries
    ? entrySearch
      ? await sql<DbFeedbackEntry[]>`
      SELECT * FROM venue.feedback_entries
      WHERE venue_id = ${venueId}::uuid
        AND created_at >= now() - (${entryDays}::text || ' days')::interval
        AND COALESCE(comment, '') ILIKE ${`%${entrySearch}%`}
      ORDER BY created_at DESC
      LIMIT 200
    `
      : await sql<DbFeedbackEntry[]>`
      SELECT * FROM venue.feedback_entries
      WHERE venue_id = ${venueId}::uuid
        AND created_at >= now() - (${entryDays}::text || ' days')::interval
      ORDER BY created_at DESC
      LIMIT 200
    `
    : [];
  return {
    summary: {
      count: summary?.count ?? 0,
      averageRating: summary?.average_rating ?? null,
      buckets: buckets.map((bucket) => ({ date: toDateKey(bucket.date), count: bucket.count, averageRating: bucket.average_rating })),
    },
    entries: entries.map(mapFeedback),
  };
};

export const publicStatus = async (slug: string, now = new Date()): Promise<PublicStatus | null> => {
  const venue = await getVenueBySlug(slug);
  if (!venue || !venue.publicEnabled) return null;

  const date = localDateKey(now, venue.timezone);
  const time = localTime(now, venue.timezone);
  const weekday = localWeekday(date);
  const [override] = (await listOverrides(venue.id, 14)).filter((entry) => entry.date === date);
  const openingRules = await listOpeningRules(venue.id);
  const rules = openingRules.filter((rule) => rule.weekday === weekday);
  const activeAssignments = await assignmentsForRange(venue.id, new Date(now.getTime() - 1), new Date(now.getTime() + 1));
  const staffedOpen = activeAssignments.some((assignment) => new Date(assignment.startsAt) <= now && now < new Date(assignment.endsAt));

  let windows = rules.map((rule) => ({ start: rule.startTime, end: rule.endTime, label: formatWindow(rule.startTime, rule.endTime) }));
  if (override?.kind === "closed") windows = [];
  if (override?.kind === "open" && override.startTime && override.endTime) {
    windows = [{ start: override.startTime, end: override.endTime, label: formatWindow(override.startTime, override.endTime) }];
  }

  const regularOpen = venue.openMode !== "staffed" && windows.some((window) => window.start <= time && time < window.end);
  const staffedCounts = venue.openMode !== "regular" && staffedOpen;
  const open = override?.kind === "closed" ? false : regularOpen || staffedCounts;
  const activeWindow = windows.find((window) => window.start <= time && time < window.end);
  const spontaneousOpen = open && staffedCounts && !regularOpen && !activeWindow;
  const todayLabel = windows.length > 0 ? windows.map((window) => window.label).join(", ") : "No regular hours today";

  const nextSlot = (await upcomingSlots(venue, 14)).find(
    (slot) => new Date(slot.startsAt) > now && (venue.openMode !== "regular" || slot.assignedCount > 0),
  );
  const nextOpeningLabel = nextSlot ? formatDateTime(nextSlot.startsAt, venue.timezone) : null;

  return {
    venue,
    open,
    spontaneousOpen,
    statusLabel: open ? "Open now" : "Closed now",
    todayLabel,
    nextOpeningLabel,
    activeWindowLabel: activeWindow?.label ?? null,
    openingRules,
    sections: await listSections(venue.id, true),
  };
};

type VenueDashboardOptions = {
  slotStartDate?: string;
  slotDays?: number;
  includeFeedbackEntries?: boolean;
  feedbackDays?: number;
  feedbackSearch?: string;
};

export const dashboard = async (venue: Venue, user: UserLike, options: VenueDashboardOptions = {}): Promise<VenueDashboard> => {
  const start = new Date();
  const end = new Date(start.getTime() + 30 * 86_400_000);
  const slotDays = Math.max(0, options.slotDays ?? 14);
  const [openingRules, overrides, templates, assignments, sections, feedback, myShiftCount] = await Promise.all([
    listOpeningRules(venue.id),
    listOverrides(venue.id),
    listTemplates(venue.id),
    assignmentsForRange(venue.id, start, end),
    listSections(venue.id),
    feedbackSummary(venue.id, {
      includeEntries: options.includeFeedbackEntries ?? false,
      entryDays: options.feedbackDays,
      entrySearch: options.feedbackSearch,
    }),
    sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM venue.shift_assignments
      WHERE venue_id = ${venue.id}::uuid
        AND user_id = ${user.id}::uuid
    `.then((rows) => rows[0]?.count ?? 0),
  ]);
  const [slots] = await Promise.all([
    slotDays > 0 ? upcomingSlots(venue, { startDate: options.slotStartDate, days: slotDays, templates }) : Promise.resolve([]),
  ]);

  return {
    venue,
    openingRules,
    overrides,
    templates,
    slots,
    assignments,
    myUpcomingShifts: assignments.filter((assignment) => assignment.userId === user.id),
    myShiftCount,
    sections,
    feedback: feedback.summary,
    feedbackEntries: feedback.entries,
  };
};

export const getOrCreateIcalToken = async (userId: string): Promise<string> => {
  const [row] = await sql<{ token: string }[]>`
    INSERT INTO venue.user_ical_tokens (user_id)
    VALUES (${userId}::uuid)
    ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
    RETURNING token
  `;
  if (!row) throw new Error("Failed to create iCal token");
  return row.token;
};

export const getUserIdByIcalToken = async (token: string): Promise<string | null> => {
  const [row] = await sql<{ user_id: string }[]>`
    SELECT user_id FROM venue.user_ical_tokens WHERE token = ${token}
  `;
  return row?.user_id ?? null;
};

export const generateUserIcs = async (userId: string, baseUrl: string): Promise<string> => {
  const rows = await sql<(DbShiftAssignment & { venue_name: string; venue_slug: string })[]>`
    SELECT sa.*, u.display_name AS user_display_name, v.name AS venue_name, v.slug AS venue_slug
    FROM venue.shift_assignments sa
    JOIN venue.venues v ON v.id = sa.venue_id
    JOIN auth.users u ON u.id = sa.user_id
    WHERE sa.user_id = ${userId}::uuid
      AND sa.ends_at >= now() - INTERVAL '30 days'
    ORDER BY sa.starts_at
  `;
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//StuVe Cloud//Venue//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const row of rows) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:venue-${row.id}@stuve.cloud`,
      `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART:${icsDate(row.starts_at)}`,
      `DTEND:${icsDate(row.ends_at)}`,
      `SUMMARY:${escapeIcs(`Shift at ${row.venue_name}`)}`,
      `DESCRIPTION:${escapeIcs(row.note ?? "Venue shift")}`,
      `URL:${escapeIcs(`${baseUrl}/app/venue/${row.venue_id}`)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
};

export const venueService = {
  access: { list: listAccess, grant: grantAccess, update: changeAccess, revoke: revokeAccess, require: requirePermission },
  venues: { list: listVenues, get: getVenue, getBySlug: getVenueBySlug, create: createVenue, update: updateVenue },
  venueTemplates: { list: listVenueTemplates, instantiate: instantiateVenueTemplate },
  openingRules: { list: listOpeningRules, create: createOpeningRule, update: updateOpeningRule, delete: deleteOpeningRule },
  overrides: { list: listOverrides, upsert: upsertOverride, update: updateOverride, delete: deleteOverride },
  templates: { list: listTemplates, create: createTemplate, update: updateTemplate, delete: deleteTemplate },
  assignments: { signupTemplate, signupTemplateWeeks, signupFree, cancel: cancelAssignment },
  sections: { list: listSections, create: createSection, update: updateSection, delete: deleteSection },
  feedback: { create: createFeedback, summary: feedbackSummary },
  publicStatus,
  dashboard,
  ical: { getOrCreateToken: getOrCreateIcalToken, getUserIdByToken: getUserIdByIcalToken, generateUser: generateUserIcs },
} as const;
