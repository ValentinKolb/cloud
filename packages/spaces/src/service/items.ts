import { type AccessUser, listUsersWithAccess } from "@valentinkolb/cloud/server";
import { toPgTextArray, toPgUuidArray } from "@valentinkolb/cloud/services";
import { type DateContext, dates } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type {
  CalendarItem,
  CreateItem,
  ItemFilter,
  ItemListResult,
  MutationResult,
  OverlapItem,
  Priority,
  Recurrence,
  SpaceAssignableUser,
  SpaceItem,
  SpaceItemAssignee,
  SpaceTag,
  UpdateItem,
} from "@/contracts";
import { publishSpaceEvent } from "./events";
import { rank } from "./rank";
import { type ExpandedRecurringEvent, expandRecurringEvents, type RecurringEvent, type RecurringOverride } from "./recurrence";

// ==========================
// Items Service
// ==========================

type DbItem = {
  id: string;
  space_id: string;
  column_id: string;
  title: string;
  description: string | null;
  location: string | null;
  url: string | null;
  starts_at: Date | null;
  ends_at: Date | null;
  all_day: boolean;
  deadline: Date | null;
  priority: string | null;
  recurrence_rrule: string | null;
  recurrence_dtstart: Date | null;
  recurrence_exdate: Date[] | null;
  recurring_event_id: string | null;
  recurrence_id: Date | null;
  rank: string;
  completed_at: Date | null;
  email_thread_id: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
};

type DbCalendarItem = {
  id: string;
  space_id: string;
  space_name: string;
  space_color: string;
  title: string;
  location: string | null;
  url: string | null;
  starts_at: Date | null;
  ends_at: Date | null;
  all_day: boolean;
  deadline: Date | null;
  priority: string | null;
  recurrence_rrule: string | null;
  recurrence_dtstart: Date | null;
  recurrence_exdate: Date[] | null;
  recurring_event_id: string | null;
  recurrence_id: Date | null;
};

type DbOverlapItem = {
  item_id: string;
  space_id: string;
  space_name: string;
  title: string;
  starts_at: Date;
  ends_at: Date;
};

type DbItemAssignee = {
  item_id: string;
  id: string;
  display_name: string;
};

type DbItemTag = {
  item_id: string;
  id: string;
  space_id: string;
  name: string;
  color: string;
};

const mapRecurrence = (row: Pick<DbItem, "recurrence_rrule" | "recurrence_dtstart" | "recurrence_exdate">): Recurrence | null => {
  if (!row.recurrence_rrule) return null;
  return {
    rrule: row.recurrence_rrule,
    dtstart: row.recurrence_dtstart?.toISOString() ?? null,
    exdate: (row.recurrence_exdate ?? []).map((date) => date.toISOString()),
  };
};

const toPgTimestampArray = (values: string[]): string => `{${values.map((value) => `"${new Date(value).toISOString()}"`).join(",")}}`;

const recurrenceValues = (recurrence: Recurrence | null | undefined) => ({
  rrule: recurrence?.rrule ?? null,
  dtstart: recurrence?.dtstart ?? null,
  exdate: recurrence?.exdate && recurrence.exdate.length > 0 ? toPgTimestampArray(recurrence.exdate) : null,
});

const listSpaceAccessIds = async (spaceId: string): Promise<string[]> => {
  const rows = await sql<{ access_id: string }[]>`
    SELECT access_id
    FROM spaces.space_access
    WHERE space_id = ${spaceId}::uuid
  `;
  return rows.map((row) => row.access_id);
};

const assignableUserDescription = (user: AccessUser): string => {
  const source = user.source.type === "direct" ? "direct access" : `via ${user.source.groupName}`;
  return `${user.uid} · ${source}`;
};

const uniqueIds = (ids: string[] | undefined): string[] => [...new Set(ids ?? [])];

export const listAssignableUsers = async (params: {
  spaceId: string;
  search?: string;
  excludeUserIds?: string[];
  limit?: number;
}): Promise<SpaceAssignableUser[]> => {
  const accessIds = await listSpaceAccessIds(params.spaceId);
  const users = await listUsersWithAccess({
    accessIds,
    search: params.search,
    excludeUserIds: params.excludeUserIds,
    limit: params.limit,
  });

  return users.map((user) => ({
    id: user.id,
    displayName: user.displayName,
    description: assignableUserDescription(user),
  }));
};

const validateAssigneeIdsInSpace = async (spaceId: string, assigneeIds: string[] | undefined): Promise<MutationResult<void>> => {
  const ids = uniqueIds(assigneeIds);
  if (ids.length === 0) return { ok: true, data: undefined };

  const accessIds = await listSpaceAccessIds(spaceId);
  const users = await listUsersWithAccess({
    accessIds,
    userIds: ids,
    limit: ids.length,
  });
  const validIds = new Set(users.map((user) => user.id));
  const invalidCount = ids.filter((id) => !validIds.has(id)).length;

  if (invalidCount > 0) {
    return {
      ok: false,
      error: invalidCount === 1 ? "Assignee must have access to this space" : "Assignees must have access to this space",
      status: 400,
    };
  }
  return { ok: true, data: undefined };
};

const validateRecurrenceInput = async (params: {
  spaceId: string;
  startsAt: string | null | undefined;
  endsAt: string | null | undefined;
  recurrence: Recurrence | null | undefined;
  recurringEventId: string | null | undefined;
  recurrenceId: string | null | undefined;
}): Promise<MutationResult<void>> => {
  const isSeries = !!params.recurrence?.rrule;
  const isOverride = !!params.recurringEventId || !!params.recurrenceId;

  if (isSeries && isOverride) {
    return { ok: false, error: "Recurring series cannot also be an override", status: 400 };
  }
  if (isSeries && (!params.startsAt || !params.endsAt)) {
    return { ok: false, error: "Recurring events require start and end times", status: 400 };
  }
  if (isOverride) {
    if (!params.recurringEventId || !params.recurrenceId) {
      return { ok: false, error: "Recurring overrides require parent event and recurrence id", status: 400 };
    }
    if (!params.startsAt || !params.endsAt) {
      return { ok: false, error: "Recurring overrides require start and end times", status: 400 };
    }
    const [parent] = await sql<{ id: string }[]>`
      SELECT id
      FROM spaces.items
      WHERE id = ${params.recurringEventId}
        AND space_id = ${params.spaceId}
        AND recurrence_rrule IS NOT NULL
        AND recurring_event_id IS NULL
    `;
    if (!parent) {
      return { ok: false, error: "Parent recurring event not found in space", status: 400 };
    }
  }

  return { ok: true, data: undefined };
};

const validateTagIdsInSpace = async (spaceId: string, tagIds: string[] | undefined): Promise<MutationResult<void>> => {
  if (!tagIds || tagIds.length === 0) return { ok: true, data: undefined };
  const uniqueTagIds = [...new Set(tagIds)];
  const [row] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM spaces.tags
    WHERE space_id = ${spaceId} AND id = ANY(${toPgUuidArray(uniqueTagIds)}::uuid[])
  `;
  if ((row?.count ?? 0) !== uniqueTagIds.length) {
    return { ok: false, error: "Tag not found in space", status: 400 };
  }
  return { ok: true, data: undefined };
};

/**
 * Converts one item row from `spaces.items` into the API-facing `SpaceItem` object.
 */
const mapToItem = (row: DbItem): SpaceItem => ({
  id: row.id,
  spaceId: row.space_id,
  columnId: row.column_id,
  title: row.title,
  description: row.description,
  location: row.location,
  url: row.url,
  startsAt: row.starts_at?.toISOString() ?? null,
  endsAt: row.ends_at?.toISOString() ?? null,
  allDay: row.all_day,
  deadline: row.deadline?.toISOString() ?? null,
  priority: (row.priority as Priority) ?? null,
  recurrence: mapRecurrence(row),
  recurringEventId: row.recurring_event_id,
  recurrenceId: row.recurrence_id?.toISOString() ?? null,
  rank: row.rank,
  completedAt: row.completed_at?.toISOString() ?? null,
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

/**
 * Get assignees for an item
 */
const getAssignees = async (itemId: string): Promise<SpaceItemAssignee[]> => {
  const rows = await sql<{ id: string; display_name: string }[]>`
    SELECT u.id, u.display_name
    FROM spaces.item_assignees ia
    JOIN auth.users u ON ia.user_id = u.id
    WHERE ia.item_id = ${itemId}
    ORDER BY u.display_name
  `;
  return rows.map((r) => ({ id: r.id, displayName: r.display_name }));
};

/**
 * Get tags for an item
 */
const getTags = async (itemId: string): Promise<SpaceTag[]> => {
  const rows = await sql<{ id: string; space_id: string; name: string; color: string }[]>`
    SELECT t.id, t.space_id, t.name, t.color
    FROM spaces.item_tags it
    JOIN spaces.tags t ON it.tag_id = t.id
    WHERE it.item_id = ${itemId}
    ORDER BY t.name
  `;
  return rows.map((r) => ({
    id: r.id,
    spaceId: r.space_id,
    name: r.name,
    color: r.color,
  }));
};

const getAssigneesByItemIds = async (itemIds: string[]): Promise<Map<string, SpaceItemAssignee[]>> => {
  if (itemIds.length === 0) return new Map();
  const rows = await sql<DbItemAssignee[]>`
    SELECT ia.item_id, u.id, u.display_name
    FROM spaces.item_assignees ia
    JOIN auth.users u ON ia.user_id = u.id
    WHERE ia.item_id = ANY(${toPgUuidArray(itemIds)}::uuid[])
    ORDER BY ia.item_id, u.display_name
  `;
  const grouped = new Map<string, SpaceItemAssignee[]>();
  for (const row of rows) {
    grouped.set(row.item_id, [...(grouped.get(row.item_id) ?? []), { id: row.id, displayName: row.display_name }]);
  }
  return grouped;
};

const getTagsByItemIds = async (itemIds: string[]): Promise<Map<string, SpaceTag[]>> => {
  if (itemIds.length === 0) return new Map();
  const rows = await sql<DbItemTag[]>`
    SELECT it.item_id, t.id, t.space_id, t.name, t.color
    FROM spaces.item_tags it
    JOIN spaces.tags t ON it.tag_id = t.id
    WHERE it.item_id = ANY(${toPgUuidArray(itemIds)}::uuid[])
    ORDER BY it.item_id, t.name
  `;
  const grouped = new Map<string, SpaceTag[]>();
  for (const row of rows) {
    grouped.set(row.item_id, [
      ...(grouped.get(row.item_id) ?? []),
      {
        id: row.id,
        spaceId: row.space_id,
        name: row.name,
        color: row.color,
      },
    ]);
  }
  return grouped;
};

const hydrateRelations = async (items: SpaceItem[]): Promise<SpaceItem[]> => {
  if (items.length === 0) return items;
  const itemIds = items.map((item) => item.id);
  const [assigneesByItemId, tagsByItemId] = await Promise.all([getAssigneesByItemIds(itemIds), getTagsByItemIds(itemIds)]);
  for (const item of items) {
    item.assignees = assigneesByItemId.get(item.id) ?? [];
    item.tags = tagsByItemId.get(item.id) ?? [];
  }
  return items;
};

const deadlineWindow = (dateConfig?: DateContext) => {
  const todayStart = dates.today(dateConfig);
  return {
    todayStart: todayStart.toISOString(),
    tomorrowStart: dates.addDays(todayStart, 1, dateConfig).toISOString(),
    weekEnd: dates.addDays(todayStart, 7, dateConfig).toISOString(),
  };
};

/**
 * Dashboard widget query: today's events and the next deadlines, across
 * every space the user can reach (direct user grant, group grant,
 * authenticated_only, or fully public). One SQL roundtrip.
 *
 * - "Events today" = items with `starts_at` or `deadline` falling inside
 *   the current day in the caller's date context, ignoring already-completed.
 * - "Next deadlines" = open items (not in is_done columns and not
 *   completed) ordered by deadline ASC NULLS LAST, then created_at.
 */
export type DashboardItem = {
  id: string;
  spaceId: string;
  spaceName: string;
  spaceColor: string | null;
  spaceIcalToken: string | null;
  title: string;
  priority: "low" | "medium" | "high" | "urgent" | null;
  startsAt: string | null;
  endsAt: string | null;
  deadline: string | null;
};

export const dashboardSnapshot = async (params: {
  userId: string;
  groups: string[];
  todoLimit: number;
  dateConfig?: DateContext;
}): Promise<{ openTodoCount: number; urgentCount: number; events: DashboardItem[]; todos: DashboardItem[] }> => {
  const groupsArr = `{${params.groups.map((g) => `"${g}"`).join(",")}}`;
  const { todayStart, tomorrowStart } = deadlineWindow(params.dateConfig);

  // Open-todo aggregate (count + urgent-count) across all reachable spaces.
  const [agg] = await sql<{ open_count: number; urgent_count: number }[]>`
    SELECT
      COUNT(*) FILTER (WHERE i.completed_at IS NULL AND c.is_done = false)::int AS open_count,
      COUNT(*) FILTER (WHERE i.completed_at IS NULL AND c.is_done = false AND i.priority = 'urgent')::int AS urgent_count
    FROM spaces.items i
    JOIN spaces.columns c ON c.id = i.column_id
    JOIN spaces.spaces s ON s.id = i.space_id
    WHERE EXISTS (
      SELECT 1 FROM spaces.space_access sa
      JOIN auth.access a ON a.id = sa.access_id
      WHERE sa.space_id = i.space_id
        AND (
          a.user_id = ${params.userId}::uuid
          OR a.group_id = ANY(${groupsArr}::uuid[])
          OR a.authenticated_only = true
          OR (a.user_id IS NULL AND a.group_id IS NULL AND a.service_account_id IS NULL AND a.authenticated_only = false)
        )
    )
  `;

  type DbWidget = {
    id: string;
    space_id: string;
    space_name: string;
    space_color: string | null;
    space_ical: string | null;
    title: string;
    priority: "low" | "medium" | "high" | "urgent" | null;
    starts_at: string | null;
    ends_at: string | null;
    deadline: string | null;
  };

  // Today's events: starts_at within today's window OR deadline within today.
  const eventRows = await sql<DbWidget[]>`
    SELECT i.id, i.space_id, s.name AS space_name, s.color AS space_color, s.ical_token AS space_ical,
           i.title, i.priority,
           i.starts_at::text AS starts_at, i.ends_at::text AS ends_at, i.deadline::text AS deadline
    FROM spaces.items i
    JOIN spaces.spaces s ON s.id = i.space_id
    WHERE i.completed_at IS NULL
      AND (
        (i.starts_at IS NOT NULL AND i.starts_at >= ${todayStart}::timestamptz AND i.starts_at < ${tomorrowStart}::timestamptz)
        OR (i.deadline IS NOT NULL AND i.deadline >= ${todayStart}::timestamptz AND i.deadline < ${tomorrowStart}::timestamptz)
      )
      AND EXISTS (
        SELECT 1 FROM spaces.space_access sa
        JOIN auth.access a ON a.id = sa.access_id
        WHERE sa.space_id = i.space_id
          AND (
            a.user_id = ${params.userId}::uuid
            OR a.group_id = ANY(${groupsArr}::uuid[])
            OR a.authenticated_only = true
            OR (a.user_id IS NULL AND a.group_id IS NULL AND a.service_account_id IS NULL AND a.authenticated_only = false)
          )
      )
    ORDER BY COALESCE(i.starts_at, i.deadline) ASC
    LIMIT 5
  `;

  // Next-up todos: open, not in is_done columns, ordered by deadline.
  const todoRows = await sql<DbWidget[]>`
    SELECT i.id, i.space_id, s.name AS space_name, s.color AS space_color, s.ical_token AS space_ical,
           i.title, i.priority,
           i.starts_at::text AS starts_at, i.ends_at::text AS ends_at, i.deadline::text AS deadline
    FROM spaces.items i
    JOIN spaces.columns c ON c.id = i.column_id
    JOIN spaces.spaces s ON s.id = i.space_id
    WHERE i.completed_at IS NULL
      AND c.is_done = false
      AND (i.starts_at IS NULL OR i.starts_at < ${todayStart}::timestamptz OR i.starts_at >= ${tomorrowStart}::timestamptz)
      AND EXISTS (
        SELECT 1 FROM spaces.space_access sa
        JOIN auth.access a ON a.id = sa.access_id
        WHERE sa.space_id = i.space_id
          AND (
            a.user_id = ${params.userId}::uuid
            OR a.group_id = ANY(${groupsArr}::uuid[])
            OR a.authenticated_only = true
            OR (a.user_id IS NULL AND a.group_id IS NULL AND a.service_account_id IS NULL AND a.authenticated_only = false)
          )
      )
    ORDER BY i.deadline ASC NULLS LAST, i.created_at ASC
    LIMIT ${params.todoLimit}
  `;

  const map = (r: DbWidget): DashboardItem => ({
    id: r.id,
    spaceId: r.space_id,
    spaceName: r.space_name,
    spaceColor: r.space_color,
    spaceIcalToken: r.space_ical,
    title: r.title,
    priority: r.priority,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    deadline: r.deadline,
  });

  return {
    openTodoCount: agg?.open_count ?? 0,
    urgentCount: agg?.urgent_count ?? 0,
    events: eventRows.map(map),
    todos: todoRows.map(map),
  };
};

/**
 * List items for a space as a plain board snapshot.
 */
export const list = async (params: { spaceId: string; includeCompleted?: boolean }): Promise<SpaceItem[]> => {
  const { spaceId, includeCompleted = false } = params;

  let rows: DbItem[];
  if (includeCompleted) {
    rows = await sql<DbItem[]>`
      SELECT
        i.id, i.space_id, i.column_id, i.title, i.description, i.location, i.url, i.starts_at, i.ends_at, i.all_day, i.deadline,
        i.priority, i.recurrence_rrule, i.recurrence_dtstart, i.recurrence_exdate, i.recurring_event_id, i.recurrence_id,
        i.rank::text AS rank,
        i.completed_at, i.email_thread_id, i.created_by, i.created_at, i.updated_at
      FROM spaces.items i
      LEFT JOIN spaces.columns c ON c.id = i.column_id
      WHERE i.space_id = ${spaceId}
      ORDER BY c.rank, i.rank
    `;
  } else {
    rows = await sql<DbItem[]>`
      SELECT
        i.id, i.space_id, i.column_id, i.title, i.description, i.location, i.url, i.starts_at, i.ends_at, i.all_day, i.deadline,
        i.priority, i.recurrence_rrule, i.recurrence_dtstart, i.recurrence_exdate, i.recurring_event_id, i.recurrence_id,
        i.rank::text AS rank,
        i.completed_at, i.email_thread_id, i.created_by, i.created_at, i.updated_at
      FROM spaces.items i
      LEFT JOIN spaces.columns c ON c.id = i.column_id
      WHERE i.space_id = ${spaceId} AND i.completed_at IS NULL
      ORDER BY c.rank, i.rank
    `;
  }

  return hydrateRelations(rows.map(mapToItem));
};

/**
 * List items with full filtering, sorting, and pagination
 * Uses parameterized queries to prevent SQL injection
 */
export const listFiltered = async (params: {
  spaceId: string;
  filter: ItemFilter;
  currentUserId?: string;
  dateConfig?: DateContext;
}): Promise<ItemListResult> => {
  const { spaceId, filter, currentUserId } = params;
  const { type, status, priority, tagIds, assigneeIds, assignedTo, columnIds, deadlineFilter, search, sort, sortDesc, page, pageSize } =
    filter;

  // Build WHERE conditions as SQL fragments (safe from injection)
  // Base condition - always filter by space
  let conditions = sql`i.space_id = ${spaceId}`;

  // Type filter (task vs event)
  if (type === "task") {
    conditions = sql`${conditions} AND (i.starts_at IS NULL OR i.ends_at IS NULL)`;
  } else if (type === "event") {
    conditions = sql`${conditions} AND (i.starts_at IS NOT NULL AND i.ends_at IS NOT NULL)`;
  }

  // Status filter
  if (status === "active") {
    conditions = sql`${conditions} AND i.completed_at IS NULL`;
  } else if (status === "completed") {
    conditions = sql`${conditions} AND i.completed_at IS NOT NULL`;
  }

  // Priority filter - use IN with parameterized values
  if (priority && priority.length > 0) {
    conditions = sql`${conditions} AND i.priority = ANY(${toPgTextArray(priority)}::text[])`;
  }

  // Column filter
  if (columnIds && columnIds.length > 0) {
    conditions = sql`${conditions} AND i.column_id = ANY(${toPgUuidArray(columnIds)}::uuid[])`;
  }

  // Deadline filter
  if (deadlineFilter === "overdue") {
    const { todayStart } = deadlineWindow(params.dateConfig);
    conditions = sql`${conditions} AND i.deadline IS NOT NULL AND i.deadline < ${todayStart}::timestamptz`;
  } else if (deadlineFilter === "today") {
    const { todayStart, tomorrowStart } = deadlineWindow(params.dateConfig);
    conditions = sql`${conditions} AND i.deadline IS NOT NULL AND i.deadline >= ${todayStart}::timestamptz AND i.deadline < ${tomorrowStart}::timestamptz`;
  } else if (deadlineFilter === "week") {
    const { todayStart, weekEnd } = deadlineWindow(params.dateConfig);
    conditions = sql`${conditions} AND i.deadline IS NOT NULL AND i.deadline >= ${todayStart}::timestamptz AND i.deadline < ${weekEnd}::timestamptz`;
  } else if (deadlineFilter === "none") {
    conditions = sql`${conditions} AND i.deadline IS NULL`;
  }

  // Tag filter (items that have ANY of the specified tags)
  if (tagIds && tagIds.length > 0) {
    conditions = sql`${conditions} AND EXISTS (
      SELECT 1 FROM spaces.item_tags it
      WHERE it.item_id = i.id AND it.tag_id = ANY(${toPgUuidArray(tagIds)}::uuid[])
    )`;
  }

  // Assignee filter (items assigned to ANY of the specified users)
  if (assigneeIds && assigneeIds.length > 0) {
    conditions = sql`${conditions} AND EXISTS (
      SELECT 1 FROM spaces.item_assignees ia
      WHERE ia.item_id = i.id AND ia.user_id = ANY(${toPgUuidArray(assigneeIds)}::uuid[])
    )`;
  }

  // AssignedTo filter (all, assigned, me, unassigned)
  if (assignedTo === "assigned") {
    conditions = sql`${conditions} AND EXISTS (
      SELECT 1 FROM spaces.item_assignees ia
      WHERE ia.item_id = i.id
    )`;
  } else if (assignedTo === "me" && currentUserId) {
    conditions = sql`${conditions} AND EXISTS (
      SELECT 1 FROM spaces.item_assignees ia
      WHERE ia.item_id = i.id AND ia.user_id = ${currentUserId}
    )`;
  } else if (assignedTo === "unassigned") {
    conditions = sql`${conditions} AND NOT EXISTS (
      SELECT 1 FROM spaces.item_assignees ia
      WHERE ia.item_id = i.id
    )`;
  }

  // Search filter (search in title and description)
  if (search && search.trim()) {
    const searchPattern = `%${search.trim()}%`;
    conditions = sql`${conditions} AND (i.title ILIKE ${searchPattern} OR i.description ILIKE ${searchPattern} OR i.location ILIKE ${searchPattern} OR i.url ILIKE ${searchPattern})`;
  }

  // Build ORDER BY clause as SQL fragment
  let orderClause = sql`c.rank ASC, i.rank ASC`;
  switch (sort) {
    case "priority":
      // Custom order: urgent > high > medium > low > null
      orderClause = sortDesc
        ? sql`CASE i.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END DESC, i.rank ASC`
        : sql`CASE i.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END ASC, i.rank ASC`;
      break;
    case "deadline":
      orderClause = sortDesc ? sql`i.deadline DESC NULLS FIRST, i.rank ASC` : sql`i.deadline ASC NULLS LAST, i.rank ASC`;
      break;
    case "created":
      orderClause = sortDesc ? sql`i.created_at DESC` : sql`i.created_at ASC`;
      break;
    case "updated":
      orderClause = sortDesc ? sql`i.updated_at DESC` : sql`i.updated_at ASC`;
      break;
    case "title":
      orderClause = sortDesc ? sql`i.title DESC` : sql`i.title ASC`;
      break;
    case "column":
      break;
  }

  // Get total count
  const [countResult] = await sql<{ count: string }[]>`
    SELECT COUNT(*) as count
    FROM spaces.items i
    WHERE ${conditions}
  `;
  const total = parseInt(countResult?.count ?? "0", 10);

  // Calculate pagination
  const totalPages = Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;

  // Get items with pagination
  const rows = await sql<DbItem[]>`
    SELECT i.id, i.space_id, i.column_id, i.title, i.description, i.location, i.url, i.starts_at, i.ends_at,
           i.all_day, i.deadline, i.priority, i.recurrence_rrule, i.recurrence_dtstart, i.recurrence_exdate, i.recurring_event_id, i.recurrence_id,
           i.rank::text AS rank,
           i.completed_at, i.email_thread_id,
           i.created_by, i.created_at, i.updated_at
    FROM spaces.items i
    LEFT JOIN spaces.columns c ON i.column_id = c.id
    WHERE ${conditions}
    ORDER BY ${orderClause}
    LIMIT ${pageSize} OFFSET ${offset}
  `;

  const items = await hydrateRelations(rows.map(mapToItem));

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
  };
};

/**
 * Cross-space item search for the global search dialog.
 *
 * Single SQL query joining items to their parent space, scoped by the same
 * permission predicate the space list uses. Replaces the per-space
 * `listFiltered` fan-out the capabilities layer used to do, which hit one
 * query per user-visible space. Skips `hydrateRelations` since the dialog
 * doesn't render assignees/tags.
 *
 * `kinds`:
 *   - "task"  → items without a starts_at/ends_at pair
 *   - "event" → items with both starts_at and ends_at
 *   - "all"   → both
 */
export type ItemAcrossKind = "task" | "event" | "all";

export type ItemAcrossResult = {
  item: SpaceItem;
  space: { id: string; name: string };
};

type DbItemAcross = DbItem & {
  space_name: string;
};

const mapCalendarRow = (r: DbCalendarItem, tags: SpaceTag[] = []): CalendarItem => ({
  id: r.id,
  spaceId: r.space_id,
  spaceName: r.space_name,
  spaceColor: r.space_color,
  title: r.title,
  location: r.location,
  url: r.url,
  startsAt: r.starts_at?.toISOString() ?? null,
  endsAt: r.ends_at?.toISOString() ?? null,
  allDay: r.all_day,
  deadline: r.deadline?.toISOString() ?? null,
  priority: (r.priority as Priority) ?? null,
  recurrence: mapRecurrence(r),
  recurringEventId: r.recurring_event_id,
  recurrenceId: r.recurrence_id?.toISOString() ?? null,
  tags,
});

const calendarRowToRecurringEvent = (item: CalendarItem): (RecurringEvent & { calendarItem: CalendarItem }) | null => {
  if (!item.startsAt || !item.endsAt || !item.recurrence) return null;
  return {
    id: item.id,
    title: item.title,
    start: item.startsAt,
    end: item.endsAt,
    allDay: item.allDay,
    recurrence: {
      rrule: item.recurrence.rrule,
      dtstart: item.recurrence.dtstart ?? item.startsAt,
      exdate: item.recurrence.exdate,
    },
    calendarItem: item,
  };
};

const calendarRowToRecurringOverride = (item: CalendarItem): (RecurringOverride & { calendarItem: CalendarItem }) | null => {
  if (!item.startsAt || !item.endsAt || !item.recurringEventId || !item.recurrenceId) return null;
  return {
    id: item.id,
    title: item.title,
    start: item.startsAt,
    end: item.endsAt,
    allDay: item.allDay,
    recurringEventId: item.recurringEventId,
    recurrenceId: item.recurrenceId,
    calendarItem: item,
  };
};

const expandedToCalendarItem = (event: ExpandedRecurringEvent & { calendarItem?: CalendarItem }): CalendarItem => {
  const source = event.calendarItem;
  if (!source) {
    const parent = event.recurringInstance?.recurringEventId ?? event.id;
    return {
      id: event.id,
      spaceId: "",
      spaceName: "",
      spaceColor: "#3b82f6",
      title: event.title,
      location: null,
      url: null,
      startsAt: new Date(event.start).toISOString(),
      endsAt: event.end ? new Date(event.end).toISOString() : null,
      allDay: event.allDay ?? false,
      deadline: null,
      priority: null,
      recurrence: null,
      recurringEventId: parent,
      recurrenceId: event.recurringInstance?.recurrenceId ?? null,
      isRecurringInstance: !!event.recurringInstance,
      tags: [],
    };
  }

  return {
    ...source,
    id: event.id,
    startsAt: new Date(event.start).toISOString(),
    endsAt: event.end ? new Date(event.end).toISOString() : null,
    recurringEventId: event.recurringInstance?.recurringEventId ?? source.recurringEventId,
    recurrenceId: event.recurringInstance?.recurrenceId ?? source.recurrenceId,
    isRecurringInstance: !!event.recurringInstance,
  };
};

export const searchAcross = async (params: {
  userId: string | null;
  groups: string[];
  query: string;
  kinds: ItemAcrossKind;
  status?: "open";
  priority?: Priority[];
  limit: number;
}): Promise<ItemAcrossResult[]> => {
  const { userId, query, kinds, limit } = params;
  const groups = params.groups ?? [];
  const trimmed = query.trim();
  // Empty query is valid — used by tag-only searches like `#task` or `#event`.
  // Pattern becomes `%%` which ILIKE-matches every row; the title-match
  // ranking CASE collapses to a constant so results sort by `updated_at DESC`.
  const pattern = `%${trimmed}%`;

  let kindCondition = sql`TRUE`;
  if (kinds === "task") {
    kindCondition = sql`(i.starts_at IS NULL OR i.ends_at IS NULL)`;
  } else if (kinds === "event") {
    kindCondition = sql`(i.starts_at IS NOT NULL AND i.ends_at IS NOT NULL)`;
  }

  const statusCondition = params.status === "open" ? sql`i.completed_at IS NULL` : sql`TRUE`;
  const priorityCondition =
    params.priority && params.priority.length > 0 ? sql`i.priority = ANY(${toPgTextArray(params.priority)}::text[])` : sql`TRUE`;

  // Permission check via EXISTS subquery rather than LEFT JOIN. The previous
  // join approach needed `SELECT DISTINCT` to dedupe items joined to multiple
  // ACL rows, but `DISTINCT` combined with `ORDER BY CASE WHEN i.title ILIKE
  // pattern THEN 0 ELSE 1 END` is illegal in Postgres (the CASE expression
  // isn't in the distinct projection). The EXISTS form has neither problem
  // and is what notebooks.searchAcross uses.
  const rows = await sql<DbItemAcross[]>`
    SELECT
      i.id, i.space_id, i.column_id, i.title, i.description, i.location, i.url, i.starts_at, i.ends_at,
      i.all_day, i.deadline, i.priority, i.recurrence_rrule, i.recurrence_dtstart, i.recurrence_exdate, i.recurring_event_id, i.recurrence_id,
      i.rank::text AS rank,
      i.completed_at, i.email_thread_id,
      i.created_by, i.created_at, i.updated_at,
      s.name AS space_name
    FROM spaces.items i
    JOIN spaces.spaces s ON s.id = i.space_id
    WHERE EXISTS (
      SELECT 1
      FROM spaces.space_access sa
      JOIN auth.access a ON a.id = sa.access_id
      WHERE sa.space_id = s.id
        AND (
          a.user_id = ${userId}::uuid
          OR a.group_id = ANY(${toPgUuidArray(groups)}::uuid[])
          OR (${userId}::uuid IS NOT NULL AND a.authenticated_only = true)
          OR (a.user_id IS NULL AND a.group_id IS NULL AND a.service_account_id IS NULL AND a.authenticated_only = false)
        )
    )
      AND ${kindCondition}
      AND ${statusCondition}
      AND ${priorityCondition}
      AND (i.title ILIKE ${pattern} OR i.description ILIKE ${pattern} OR i.location ILIKE ${pattern} OR i.url ILIKE ${pattern})
    ORDER BY
      CASE WHEN i.title ILIKE ${pattern} THEN 0 ELSE 1 END,
      i.updated_at DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    item: mapToItem(row),
    space: { id: row.space_id, name: row.space_name },
  }));
};

/**
 * Get an item by ID with relations
 */
export const get = async (params: { id: string }): Promise<SpaceItem | null> => {
  const [row] = await sql<DbItem[]>`
    SELECT
      i.id,
      i.space_id,
      i.column_id,
      i.title,
      i.description,
      i.location,
      i.url,
      i.starts_at,
      i.ends_at,
      i.all_day,
      i.deadline,
      i.priority,
      i.recurrence_rrule,
      i.recurrence_dtstart,
      i.recurrence_exdate,
      i.recurring_event_id,
      i.recurrence_id,
      i.rank::text AS rank,
      i.completed_at,
      i.email_thread_id,
      i.created_by,
      i.created_at,
      i.updated_at
    FROM spaces.items i
    WHERE i.id = ${params.id}
  `;

  if (!row) return null;

  const item = mapToItem(row);
  item.assignees = await getAssignees(item.id);
  item.tags = await getTags(item.id);

  return item;
};

/**
 * Create a new item
 */
export const create = async (params: { spaceId: string; data: CreateItem; createdBy: string }): Promise<MutationResult<SpaceItem>> => {
  const { spaceId, data, createdBy } = params;

  // Verify column belongs to space
  const [column] = await sql<{ id: string }[]>`
    SELECT id FROM spaces.columns
    WHERE id = ${data.columnId} AND space_id = ${spaceId}
  `;

  if (!column) {
    return { ok: false, error: "Column not found in space", status: 400 };
  }

  const recurrenceCheck = await validateRecurrenceInput({
    spaceId,
    startsAt: data.startsAt,
    endsAt: data.endsAt,
    recurrence: data.recurrence,
    recurringEventId: data.recurringEventId,
    recurrenceId: data.recurrenceId,
  });
  if (!recurrenceCheck.ok) return recurrenceCheck;
  const tagCheck = await validateTagIdsInSpace(spaceId, data.tagIds);
  if (!tagCheck.ok) return tagCheck;
  const assigneeCheck = await validateAssigneeIdsInSpace(spaceId, data.assigneeIds);
  if (!assigneeCheck.ok) return assigneeCheck;

  // Get next rank in column
  const [maxRow] = await sql<{ max: string | null }[]>`
    SELECT MAX(rank)::text as max
    FROM spaces.items
    WHERE column_id = ${data.columnId}
  `;
  const nextRank = rank.next(maxRow?.max);
  const recurrence = recurrenceValues(data.recurrence);

  const [row] = await sql<{ id: string }[]>`
    INSERT INTO spaces.items (
      space_id, column_id, title, description, location, url, starts_at, ends_at, deadline,
      all_day, priority, recurrence_rrule, recurrence_dtstart, recurrence_exdate,
      recurring_event_id, recurrence_id, rank, completed_at, created_by
    )
    VALUES (
      ${spaceId},
      ${data.columnId},
      ${data.title},
      ${data.description ?? null},
      ${data.location ?? null},
      ${data.url ?? null},
      ${data.startsAt ?? null},
      ${data.endsAt ?? null},
      ${data.deadline ?? null},
      ${data.allDay ?? false},
      ${data.priority ?? null},
      ${recurrence.rrule},
      ${recurrence.dtstart},
      ${recurrence.exdate ? sql`${recurrence.exdate}::timestamptz[]` : null},
      ${data.recurringEventId ?? null},
      ${data.recurrenceId ?? null},
      ${rank.toDb(nextRank)}::bigint,
      ${null},
      ${createdBy}
    )
    RETURNING id
  `;

  if (!row) {
    return { ok: false, error: "Failed to create item", status: 500 };
  }

  // Set assignees
  if (data.assigneeIds?.length) {
    for (const userId of data.assigneeIds) {
      await sql`
        INSERT INTO spaces.item_assignees (item_id, user_id)
        VALUES (${row.id}, ${userId})
        ON CONFLICT DO NOTHING
      `;
    }
  }

  // Set tags
  if (data.tagIds?.length) {
    for (const tagId of data.tagIds) {
      await sql`
        INSERT INTO spaces.item_tags (item_id, tag_id)
        VALUES (${row.id}, ${tagId})
        ON CONFLICT DO NOTHING
      `;
    }
  }

  const item = await get({ id: row.id });
  if (!item) {
    return { ok: false, error: "Failed to load created item", status: 500 };
  }

  await publishSpaceEvent({ type: "item.created", spaceId, itemId: item.id });
  return { ok: true, data: item };
};

/**
 * Update an item
 */
export const update = async (params: { id: string; data: UpdateItem }): Promise<MutationResult<SpaceItem>> => {
  const { id, data } = params;

  const existing = await get({ id });
  if (!existing) {
    return { ok: false, error: "Item not found", status: 404 };
  }

  // Build update values
  const columnId = data.columnId ?? existing.columnId;
  const title = data.title ?? existing.title;
  const description = data.description === undefined ? existing.description : data.description;
  const location = data.location === undefined ? existing.location : data.location;
  const url = data.url === undefined ? existing.url : data.url;
  const startsAt = data.startsAt === undefined ? existing.startsAt : data.startsAt;
  const endsAt = data.endsAt === undefined ? existing.endsAt : data.endsAt;
  const allDay = data.allDay === undefined ? existing.allDay : data.allDay;
  const deadline = data.deadline === undefined ? existing.deadline : data.deadline;
  const priority = data.priority === undefined ? existing.priority : data.priority;
  const recurrence = data.recurrence === undefined ? existing.recurrence : data.recurrence;
  const recurringEventId = data.recurringEventId === undefined ? existing.recurringEventId : data.recurringEventId;
  const recurrenceId = data.recurrenceId === undefined ? existing.recurrenceId : data.recurrenceId;
  const changingColumn = !!(data.columnId && data.columnId !== existing.columnId);

  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
    return { ok: false, error: "End time must be after start time", status: 400 };
  }

  // If moving to a different column, prepend item to the top of the target column.
  let targetRank: bigint | null = null;
  if (changingColumn && data.columnId) {
    const [newColumn] = await sql<{ space_id: string }[]>`
      SELECT space_id
      FROM spaces.columns
      WHERE id = ${data.columnId}
    `;
    if (!newColumn || newColumn.space_id !== existing.spaceId) {
      return { ok: false, error: "Column not found in space", status: 400 };
    }

    const [minRow] = await sql<{ min: string | null }[]>`
      SELECT MIN(rank)::text AS min
      FROM spaces.items
      WHERE column_id = ${data.columnId} AND id <> ${id}
    `;
    const minRank = minRow?.min ? rank.parse(minRow.min) : null;
    targetRank = minRank !== null ? minRank - rank.step() : rank.step();
  }
  const recurrenceCheck = await validateRecurrenceInput({
    spaceId: existing.spaceId,
    startsAt,
    endsAt,
    recurrence,
    recurringEventId,
    recurrenceId,
  });
  if (!recurrenceCheck.ok) return recurrenceCheck;
  const tagCheck = await validateTagIdsInSpace(existing.spaceId, data.tagIds);
  if (!tagCheck.ok) return tagCheck;
  const assigneeCheck = await validateAssigneeIdsInSpace(existing.spaceId, data.assigneeIds);
  if (!assigneeCheck.ok) return assigneeCheck;
  const recurrenceDb = recurrenceValues(recurrence);

  const [row] = changingColumn
    ? await sql<{ id: string }[]>`
        UPDATE spaces.items
        SET column_id = ${columnId},
            rank = ${rank.toDb(targetRank ?? rank.step())}::bigint,
            title = ${title},
            description = ${description},
            location = ${location},
            url = ${url},
            starts_at = ${startsAt},
            ends_at = ${endsAt},
            all_day = ${allDay},
            deadline = ${deadline},
            priority = ${priority},
            recurrence_rrule = ${recurrenceDb.rrule},
            recurrence_dtstart = ${recurrenceDb.dtstart},
            recurrence_exdate = ${recurrenceDb.exdate ? sql`${recurrenceDb.exdate}::timestamptz[]` : null},
            recurring_event_id = ${recurringEventId},
            recurrence_id = ${recurrenceId},
            updated_at = now()
        WHERE id = ${id}
        RETURNING id
      `
    : await sql<{ id: string }[]>`
        UPDATE spaces.items
        SET title = ${title},
            description = ${description},
            location = ${location},
            url = ${url},
            starts_at = ${startsAt},
            ends_at = ${endsAt},
            all_day = ${allDay},
            deadline = ${deadline},
            priority = ${priority},
            recurrence_rrule = ${recurrenceDb.rrule},
            recurrence_dtstart = ${recurrenceDb.dtstart},
            recurrence_exdate = ${recurrenceDb.exdate ? sql`${recurrenceDb.exdate}::timestamptz[]` : null},
            recurring_event_id = ${recurringEventId},
            recurrence_id = ${recurrenceId},
            updated_at = now()
        WHERE id = ${id}
        RETURNING id
      `;

  if (!row) {
    return { ok: false, error: "Failed to update item", status: 500 };
  }

  // Update assignees if provided
  if (data.assigneeIds !== undefined) {
    await sql`DELETE FROM spaces.item_assignees WHERE item_id = ${id}`;
    for (const userId of data.assigneeIds) {
      await sql`
        INSERT INTO spaces.item_assignees (item_id, user_id)
        VALUES (${id}, ${userId})
        ON CONFLICT DO NOTHING
      `;
    }
  }

  // Update tags if provided
  if (data.tagIds !== undefined) {
    await sql`DELETE FROM spaces.item_tags WHERE item_id = ${id}`;
    for (const tagId of data.tagIds) {
      await sql`
        INSERT INTO spaces.item_tags (item_id, tag_id)
        VALUES (${id}, ${tagId})
        ON CONFLICT DO NOTHING
      `;
    }
  }

  const item = await get({ id: row.id });
  if (!item) {
    return { ok: false, error: "Failed to load updated item", status: 500 };
  }

  await publishSpaceEvent({ type: "item.updated", spaceId: item.spaceId, itemId: item.id });
  return { ok: true, data: item };
};

/**
 * Delete an item
 */
export const remove = async (params: { id: string }): Promise<MutationResult<void>> => {
  const existing = await get({ id: params.id });
  const result = await sql`
    DELETE FROM spaces.items
    WHERE id = ${params.id}
  `;

  if (result.count === 0) {
    return { ok: false, error: "Item not found", status: 404 };
  }

  if (existing) await publishSpaceEvent({ type: "item.deleted", spaceId: existing.spaceId, itemId: existing.id });
  return { ok: true, data: undefined };
};

/**
 * Move an item to a different column/rank
 */
export const move = async (params: {
  id: string;
  columnId: string;
  rank: string;
  completed?: boolean;
}): Promise<MutationResult<SpaceItem>> => {
  const { id, columnId } = params;
  let targetRank: bigint;
  try {
    targetRank = rank.parse(params.rank);
  } catch {
    return { ok: false, error: "Invalid rank", status: 400 };
  }

  const [existing] = await sql<
    {
      id: string;
      space_id: string;
      column_id: string;
      rank: string;
      completed_at: Date | null;
    }[]
  >`
    SELECT id, space_id, column_id, rank::text AS rank, completed_at
    FROM spaces.items
    WHERE id = ${id}
  `;

  if (!existing) {
    return { ok: false, error: "Item not found", status: 404 };
  }

  // Verify column belongs to same space
  const [column] = await sql<{ id: string; space_id: string }[]>`
    SELECT id, space_id FROM spaces.columns WHERE id = ${columnId}
  `;

  if (!column || column.space_id !== existing.space_id) {
    return { ok: false, error: "Column not found in space", status: 400 };
  }

  const completedAt = typeof params.completed === "boolean" ? (params.completed ? new Date() : null) : undefined;

  // Move the item (and optionally align completion state atomically in the same update).
  const [row] =
    completedAt === undefined
      ? await sql<{ id: string }[]>`
          UPDATE spaces.items
          SET column_id = ${columnId},
              rank = ${rank.toDb(targetRank)}::bigint,
              updated_at = now()
          WHERE id = ${id}
          RETURNING id
        `
      : await sql<{ id: string }[]>`
          UPDATE spaces.items
          SET column_id = ${columnId},
              rank = ${rank.toDb(targetRank)}::bigint,
              completed_at = ${completedAt},
              updated_at = now()
          WHERE id = ${id}
          RETURNING id
        `;

  if (!row) {
    return { ok: false, error: "Failed to move item", status: 500 };
  }

  const item = await get({ id: row.id });
  if (!item) {
    return { ok: false, error: "Failed to load moved item", status: 500 };
  }

  await publishSpaceEvent({ type: "item.moved", spaceId: item.spaceId, itemId: item.id });
  return { ok: true, data: item };
};

/**
 * Set completion status of an item
 */
export const setCompleted = async (params: { id: string; completed: boolean }): Promise<MutationResult<SpaceItem>> => {
  const { id, completed } = params;

  const completedAt = completed ? new Date() : null;

  const [row] = await sql<{ id: string }[]>`
    UPDATE spaces.items
    SET completed_at = ${completedAt}, updated_at = now()
    WHERE id = ${id}
    RETURNING id
  `;

  if (!row) {
    return { ok: false, error: "Item not found", status: 404 };
  }

  const item = await get({ id: row.id });
  if (!item) {
    return { ok: false, error: "Failed to load item", status: 500 };
  }

  await publishSpaceEvent({ type: "item.completed", spaceId: item.spaceId, itemId: item.id });
  return { ok: true, data: item };
};

/**
 * Set assignees for an item
 */
export const setAssignees = async (params: { id: string; userIds: string[] }): Promise<MutationResult<void>> => {
  const { id, userIds } = params;

  // Verify item exists
  const existing = await get({ id });
  if (!existing) {
    return { ok: false, error: "Item not found", status: 404 };
  }

  const assigneeCheck = await validateAssigneeIdsInSpace(existing.spaceId, userIds);
  if (!assigneeCheck.ok) return assigneeCheck;

  await sql`DELETE FROM spaces.item_assignees WHERE item_id = ${id}`;

  for (const userId of userIds) {
    await sql`
      INSERT INTO spaces.item_assignees (item_id, user_id)
      VALUES (${id}, ${userId})
      ON CONFLICT DO NOTHING
    `;
  }

  await publishSpaceEvent({ type: "item.updated", spaceId: existing.spaceId, itemId: existing.id });
  return { ok: true, data: undefined };
};

/**
 * Set tags for an item
 */
export const setTags = async (params: { id: string; tagIds: string[] }): Promise<MutationResult<void>> => {
  const { id, tagIds } = params;

  // Verify item exists
  const existing = await get({ id });
  if (!existing) {
    return { ok: false, error: "Item not found", status: 404 };
  }
  const tagCheck = await validateTagIdsInSpace(existing.spaceId, tagIds);
  if (!tagCheck.ok) return tagCheck;

  await sql`DELETE FROM spaces.item_tags WHERE item_id = ${id}`;

  for (const tagId of tagIds) {
    await sql`
      INSERT INTO spaces.item_tags (item_id, tag_id)
      VALUES (${id}, ${tagId})
      ON CONFLICT DO NOTHING
    `;
  }

  await publishSpaceEvent({ type: "item.updated", spaceId: existing.spaceId, itemId: existing.id });
  return { ok: true, data: undefined };
};

/**
 * List calendar items (across multiple spaces the user has access to)
 */
export const listCalendar = async (params: {
  userId: string;
  groups: string[];
  from: string;
  to: string;
  dateConfig?: DateContext;
}): Promise<CalendarItem[]> => {
  const { userId, from, to } = params;
  const groups = params.groups ?? [];

  // Use subquery to get accessible space IDs first, then query items
  const rows = await sql<DbCalendarItem[]>`
    WITH accessible_spaces AS (
      SELECT DISTINCT s.id
      FROM spaces.spaces s
      JOIN spaces.space_access sa ON s.id = sa.space_id
      JOIN auth.access a ON sa.access_id = a.id
      WHERE a.user_id = ${userId}::uuid
         OR a.group_id = ANY(${toPgUuidArray(groups)}::uuid[])
         OR (${userId}::uuid IS NOT NULL AND a.authenticated_only = true)
         OR (a.user_id IS NULL AND a.group_id IS NULL AND a.service_account_id IS NULL AND a.authenticated_only = false)
    )
    SELECT i.id, i.space_id, s.name as space_name, s.color as space_color,
           i.title, i.location, i.url, i.starts_at, i.ends_at, i.all_day, i.deadline, i.priority,
           i.recurrence_rrule, i.recurrence_dtstart, i.recurrence_exdate, i.recurring_event_id, i.recurrence_id
    FROM spaces.items i
    JOIN spaces.spaces s ON i.space_id = s.id
    WHERE i.space_id IN (SELECT id FROM accessible_spaces)
      AND i.completed_at IS NULL
      AND (
        (
          i.recurrence_rrule IS NULL
          AND i.starts_at IS NOT NULL
          AND i.ends_at IS NOT NULL
          AND i.starts_at < ${to}::timestamptz
          AND i.ends_at > ${from}::timestamptz
        )
        OR (
          i.recurrence_rrule IS NOT NULL
          AND i.recurring_event_id IS NULL
          AND i.starts_at IS NOT NULL
          AND i.ends_at IS NOT NULL
        )
        OR (
          i.recurring_event_id IS NOT NULL
          AND i.recurrence_id IS NOT NULL
          AND i.starts_at IS NOT NULL
          AND i.ends_at IS NOT NULL
          AND i.starts_at < ${to}::timestamptz
          AND i.ends_at > ${from}::timestamptz
        )
        OR (i.deadline IS NOT NULL AND i.deadline >= ${from}::timestamptz AND i.deadline < ${to}::timestamptz)
      )
    ORDER BY COALESCE(i.starts_at, i.deadline)
  `;

  const tagsByItemId = await getTagsByItemIds(rows.map((row) => row.id));
  const items = rows.map((row) => mapCalendarRow(row, tagsByItemId.get(row.id) ?? []));
  const recurringEvents = items
    .map(calendarRowToRecurringEvent)
    .filter((event): event is RecurringEvent & { calendarItem: CalendarItem } => !!event);
  const overrides = items
    .map(calendarRowToRecurringOverride)
    .filter((event): event is RecurringOverride & { calendarItem: CalendarItem } => !!event);
  const recurringSourceIds = new Set(recurringEvents.map((event) => event.id));
  const recurringOverrideIds = new Set(overrides.map((event) => event.id));
  const regularItems = items.filter((item) => !recurringSourceIds.has(item.id) && !recurringOverrideIds.has(item.id));
  const expanded = expandRecurringEvents({
    events: recurringEvents,
    overrides,
    rangeStart: from,
    rangeEnd: to,
    dateConfig: params.dateConfig,
  }).map((event) => expandedToCalendarItem(event as ExpandedRecurringEvent & { calendarItem?: CalendarItem }));

  return [...regularItems, ...expanded].sort((a, b) => {
    const aTime = new Date(a.startsAt ?? a.deadline ?? 0).getTime();
    const bTime = new Date(b.startsAt ?? b.deadline ?? 0).getTime();
    return aTime - bTime;
  });
};

/** Task item for widget display */
export type TaskItem = {
  id: string;
  spaceId: string;
  spaceName: string;
  spaceColor: string;
  title: string;
  deadline: string | null;
  priority: Priority | null;
};

/**
 * List tasks assigned to a specific user (across all spaces they have access to)
 */
export const listMyTasks = async (params: {
  userId: string;
  groups: string[];
  minPriority?: Priority;
  limit?: number;
}): Promise<TaskItem[]> => {
  const { userId, minPriority, limit = 20 } = params;
  const groups = params.groups ?? [];

  // Build priority filter
  let priorityCondition = sql``;
  if (minPriority) {
    const priorityOrder = { urgent: 1, high: 2, medium: 3, low: 4 };
    const minOrder = priorityOrder[minPriority];
    const allowedPriorities = Object.entries(priorityOrder)
      .filter(([_, order]) => order <= minOrder)
      .map(([p]) => p);
    priorityCondition = sql`AND i.priority = ANY(${toPgTextArray(allowedPriorities)}::text[])`;
  }

  // Use subquery to get accessible space IDs first, then query items
  const rows = await sql<
    {
      id: string;
      space_id: string;
      space_name: string;
      space_color: string;
      title: string;
      deadline: Date | null;
      priority: string | null;
    }[]
  >`
    WITH accessible_spaces AS (
      SELECT DISTINCT s.id
      FROM spaces.spaces s
      JOIN spaces.space_access sa ON s.id = sa.space_id
      JOIN auth.access a ON sa.access_id = a.id
      WHERE a.user_id = ${userId}::uuid
         OR a.group_id = ANY(${toPgUuidArray(groups)}::uuid[])
         OR (${userId}::uuid IS NOT NULL AND a.authenticated_only = true)
         OR (a.user_id IS NULL AND a.group_id IS NULL AND a.service_account_id IS NULL AND a.authenticated_only = false)
    )
    SELECT i.id, i.space_id, s.name as space_name, s.color as space_color,
           i.title, i.deadline, i.priority
    FROM spaces.items i
    JOIN spaces.spaces s ON i.space_id = s.id
    WHERE i.space_id IN (SELECT id FROM accessible_spaces)
      AND i.completed_at IS NULL
      AND (i.starts_at IS NULL OR i.ends_at IS NULL)
      AND EXISTS (
        SELECT 1 FROM spaces.item_assignees ia
        WHERE ia.item_id = i.id AND ia.user_id = ${userId}
      )
      ${priorityCondition}
    ORDER BY
      CASE i.priority
        WHEN 'urgent' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
        ELSE 5
      END,
      i.deadline ASC NULLS LAST,
      i.created_at DESC
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    id: r.id,
    spaceId: r.space_id,
    spaceName: r.space_name,
    spaceColor: r.space_color,
    title: r.title,
    deadline: r.deadline?.toISOString() ?? null,
    priority: (r.priority as Priority) ?? null,
  }));
};

/**
 * Check for overlapping items across the spaces the current user can reach.
 */
export const checkOverlap = async (params: {
  userId: string;
  groups: string[];
  from: string;
  to: string;
  excludeItemId?: string;
}): Promise<OverlapItem[]> => {
  const { userId, from, to, excludeItemId } = params;
  const groups = params.groups ?? [];

  const rows = await sql<DbOverlapItem[]>`
    SELECT i.id AS item_id, i.space_id, s.name AS space_name, i.title, i.starts_at, i.ends_at
    FROM spaces.items i
    JOIN spaces.spaces s ON s.id = i.space_id
    WHERE i.starts_at IS NOT NULL
      AND i.ends_at IS NOT NULL
      AND i.starts_at < ${to}::timestamptz
      AND i.ends_at > ${from}::timestamptz
      AND (${excludeItemId ?? null}::uuid IS NULL OR i.id <> ${excludeItemId ?? null}::uuid)
      AND EXISTS (
        SELECT 1
        FROM spaces.space_access sa
        JOIN auth.access a ON a.id = sa.access_id
        WHERE sa.space_id = i.space_id
          AND (
            a.user_id = ${userId}::uuid
            OR a.group_id = ANY(${toPgUuidArray(groups)}::uuid[])
            OR (${userId}::uuid IS NOT NULL AND a.authenticated_only = true)
            OR (a.user_id IS NULL AND a.group_id IS NULL AND a.service_account_id IS NULL AND a.authenticated_only = false)
          )
      )
    ORDER BY i.starts_at ASC
  `;

  return rows.map((r) => ({
    itemId: r.item_id,
    spaceId: r.space_id,
    spaceName: r.space_name,
    title: r.title,
    startsAt: r.starts_at.toISOString(),
    endsAt: r.ends_at.toISOString(),
  }));
};
