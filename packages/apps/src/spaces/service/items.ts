import { sql } from "bun";
import type {
  MutationResult,
  SpaceItem,
  SpaceTag,
  SpaceItemAssignee,
  CalendarItem,
  OverlapItem,
  CreateItem,
  UpdateItem,
  Priority,
  ItemFilter,
  ItemListResult,
} from "@/spaces/contracts";
import { rank } from "./rank";

// ==========================
// Items Service
// ==========================

type DbItem = {
  id: string;
  space_id: string;
  column_id: string;
  title: string;
  description: string | null;
  starts_at: Date | null;
  ends_at: Date | null;
  deadline: Date | null;
  priority: string | null;
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
  starts_at: Date | null;
  ends_at: Date | null;
  deadline: Date | null;
  priority: string | null;
};

type DbOverlapItem = {
  item_id: string;
  space_id: string;
  space_name: string;
  title: string;
  starts_at: Date;
  ends_at: Date;
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
  startsAt: row.starts_at?.toISOString() ?? null,
  endsAt: row.ends_at?.toISOString() ?? null,
  deadline: row.deadline?.toISOString() ?? null,
  priority: (row.priority as Priority) ?? null,
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

/**
 * List items for a space (board view) - simple version for backwards compatibility
 */
export const list = async (params: { spaceId: string; includeCompleted?: boolean }): Promise<SpaceItem[]> => {
  const { spaceId, includeCompleted = false } = params;

  let rows: DbItem[];
  if (includeCompleted) {
    rows = await sql<DbItem[]>`
      SELECT
        i.id, i.space_id, i.column_id, i.title, i.description, i.starts_at, i.ends_at, i.deadline,
        i.priority, i.rank::text AS rank,
        i.completed_at, i.email_thread_id, i.created_by, i.created_at, i.updated_at
      FROM spaces.items i
      LEFT JOIN spaces.columns c ON c.id = i.column_id
      WHERE i.space_id = ${spaceId}
      ORDER BY c.rank, i.rank
    `;
  } else {
    rows = await sql<DbItem[]>`
      SELECT
        i.id, i.space_id, i.column_id, i.title, i.description, i.starts_at, i.ends_at, i.deadline,
        i.priority, i.rank::text AS rank,
        i.completed_at, i.email_thread_id, i.created_by, i.created_at, i.updated_at
      FROM spaces.items i
      LEFT JOIN spaces.columns c ON c.id = i.column_id
      WHERE i.space_id = ${spaceId} AND i.completed_at IS NULL
      ORDER BY c.rank, i.rank
    `;
  }

  // Load relations for all items
  const items = rows.map(mapToItem);
  for (const item of items) {
    item.assignees = await getAssignees(item.id);
    item.tags = await getTags(item.id);
  }

  return items;
};

/**
 * List items with full filtering, sorting, and pagination
 * Uses parameterized queries to prevent SQL injection
 */
export const listFiltered = async (params: { spaceId: string; filter: ItemFilter; currentUserId?: string }): Promise<ItemListResult> => {
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
    conditions = sql`${conditions} AND i.priority IN ${sql(priority)}`;
  }

  // Column filter
  if (columnIds && columnIds.length > 0) {
    conditions = sql`${conditions} AND i.column_id IN ${sql(columnIds)}`;
  }

  // Deadline filter
  if (deadlineFilter === "overdue") {
    conditions = sql`${conditions} AND i.deadline IS NOT NULL AND i.deadline < NOW()`;
  } else if (deadlineFilter === "today") {
    conditions = sql`${conditions} AND i.deadline IS NOT NULL AND i.deadline::date = CURRENT_DATE`;
  } else if (deadlineFilter === "week") {
    conditions = sql`${conditions} AND i.deadline IS NOT NULL AND i.deadline >= CURRENT_DATE AND i.deadline < CURRENT_DATE + INTERVAL '7 days'`;
  } else if (deadlineFilter === "none") {
    conditions = sql`${conditions} AND i.deadline IS NULL`;
  }

  // Tag filter (items that have ANY of the specified tags)
  if (tagIds && tagIds.length > 0) {
    conditions = sql`${conditions} AND EXISTS (
      SELECT 1 FROM spaces.item_tags it
      WHERE it.item_id = i.id AND it.tag_id IN ${sql(tagIds)}
    )`;
  }

  // Assignee filter (items assigned to ANY of the specified users)
  if (assigneeIds && assigneeIds.length > 0) {
    conditions = sql`${conditions} AND EXISTS (
      SELECT 1 FROM spaces.item_assignees ia
      WHERE ia.item_id = i.id AND ia.user_id IN ${sql(assigneeIds)}
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
    conditions = sql`${conditions} AND (i.title ILIKE ${searchPattern} OR i.description ILIKE ${searchPattern})`;
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
    SELECT i.id, i.space_id, i.column_id, i.title, i.description, i.starts_at, i.ends_at,
           i.deadline, i.priority, i.rank::text AS rank,
           i.completed_at, i.email_thread_id,
           i.created_by, i.created_at, i.updated_at
    FROM spaces.items i
    LEFT JOIN spaces.columns c ON i.column_id = c.id
    WHERE ${conditions}
    ORDER BY ${orderClause}
    LIMIT ${pageSize} OFFSET ${offset}
  `;

  // Load relations for all items
  const items = rows.map(mapToItem);
  for (const item of items) {
    item.assignees = await getAssignees(item.id);
    item.tags = await getTags(item.id);
  }

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
  };
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
      i.starts_at,
      i.ends_at,
      i.deadline,
      i.priority,
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

  // Get next rank in column
  const [maxRow] = await sql<{ max: string | null }[]>`
    SELECT MAX(rank)::text as max
    FROM spaces.items
    WHERE column_id = ${data.columnId}
  `;
  const nextRank = rank.next(maxRow?.max);

  const [row] = await sql<{ id: string }[]>`
    INSERT INTO spaces.items (
      space_id, column_id, title, description, starts_at, ends_at, deadline,
      priority, rank, completed_at, created_by
    )
    VALUES (
      ${spaceId},
      ${data.columnId},
      ${data.title},
      ${data.description ?? null},
      ${data.startsAt ?? null},
      ${data.endsAt ?? null},
      ${data.deadline ?? null},
      ${data.priority ?? null},
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
  const startsAt = data.startsAt === undefined ? existing.startsAt : data.startsAt;
  const endsAt = data.endsAt === undefined ? existing.endsAt : data.endsAt;
  const deadline = data.deadline === undefined ? existing.deadline : data.deadline;
  const priority = data.priority === undefined ? existing.priority : data.priority;
  const changingColumn = !!(data.columnId && data.columnId !== existing.columnId);

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

  const [row] = changingColumn
    ? await sql<{ id: string }[]>`
        UPDATE spaces.items
        SET column_id = ${columnId},
            rank = ${rank.toDb(targetRank ?? rank.step())}::bigint,
            title = ${title},
            description = ${description},
            starts_at = ${startsAt},
            ends_at = ${endsAt},
            deadline = ${deadline},
            priority = ${priority},
            updated_at = now()
        WHERE id = ${id}
        RETURNING id
      `
    : await sql<{ id: string }[]>`
        UPDATE spaces.items
        SET title = ${title},
            description = ${description},
            starts_at = ${startsAt},
            ends_at = ${endsAt},
            deadline = ${deadline},
            priority = ${priority},
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

  return { ok: true, data: item };
};

/**
 * Delete an item
 */
export const remove = async (params: { id: string }): Promise<MutationResult<void>> => {
  const result = await sql`
    DELETE FROM spaces.items
    WHERE id = ${params.id}
  `;

  if (result.count === 0) {
    return { ok: false, error: "Item not found", status: 404 };
  }

  return { ok: true, data: undefined };
};

/**
 * Move an item to a different column/rank
 */
export const move = async (params: { id: string; columnId: string; rank: string; completed?: boolean }): Promise<MutationResult<SpaceItem>> => {
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

  return { ok: true, data: item };
};

/**
 * Set assignees for an item
 */
export const setAssignees = async (params: { id: string; userIds: string[] }): Promise<MutationResult<void>> => {
  const { id, userIds } = params;

  // Verify item exists
  const [exists] = await sql<{ id: string }[]>`SELECT id FROM spaces.items WHERE id = ${id}`;
  if (!exists) {
    return { ok: false, error: "Item not found", status: 404 };
  }

  await sql`DELETE FROM spaces.item_assignees WHERE item_id = ${id}`;

  for (const userId of userIds) {
    await sql`
      INSERT INTO spaces.item_assignees (item_id, user_id)
      VALUES (${id}, ${userId})
      ON CONFLICT DO NOTHING
    `;
  }

  return { ok: true, data: undefined };
};

/**
 * Set tags for an item
 */
export const setTags = async (params: { id: string; tagIds: string[] }): Promise<MutationResult<void>> => {
  const { id, tagIds } = params;

  // Verify item exists
  const [exists] = await sql<{ id: string }[]>`SELECT id FROM spaces.items WHERE id = ${id}`;
  if (!exists) {
    return { ok: false, error: "Item not found", status: 404 };
  }

  await sql`DELETE FROM spaces.item_tags WHERE item_id = ${id}`;

  for (const tagId of tagIds) {
    await sql`
      INSERT INTO spaces.item_tags (item_id, tag_id)
      VALUES (${id}, ${tagId})
      ON CONFLICT DO NOTHING
    `;
  }

  return { ok: true, data: undefined };
};

/**
 * Escapes group CN values into a Postgres `text[]` literal for access-aware calendar queries.
 */
const toPgTextArray = (values: string[]): string => `{${values.map((value) => `"${value.replace(/"/g, '\\"')}"`).join(",")}}`;

/**
 * List calendar items (across multiple spaces the user has access to)
 */
export const listCalendar = async (params: { userId: string; groups: string[]; from: string; to: string }): Promise<CalendarItem[]> => {
  const { userId, groups, from, to } = params;

  // Use subquery to get accessible space IDs first, then query items
  const rows = await sql<DbCalendarItem[]>`
    WITH accessible_spaces AS (
      SELECT DISTINCT s.id
      FROM spaces.spaces s
      JOIN spaces.space_access sa ON s.id = sa.space_id
      JOIN auth.access a ON sa.access_id = a.id
      WHERE a.user_id = ${userId}::uuid
         OR a.group_cn = ANY(${toPgTextArray(groups)}::text[])
         OR (${userId}::uuid IS NOT NULL AND a.authenticated_only = true)
         OR (a.user_id IS NULL AND a.group_cn IS NULL AND a.authenticated_only = false)
    )
    SELECT i.id, i.space_id, s.name as space_name, s.color as space_color,
           i.title, i.starts_at, i.ends_at, i.deadline, i.priority
    FROM spaces.items i
    JOIN spaces.spaces s ON i.space_id = s.id
    WHERE i.space_id IN (SELECT id FROM accessible_spaces)
      AND i.completed_at IS NULL
      AND (
        (i.starts_at IS NOT NULL AND i.ends_at IS NOT NULL
         AND i.starts_at < ${to}::timestamptz AND i.ends_at > ${from}::timestamptz)
        OR (i.deadline IS NOT NULL AND i.deadline >= ${from}::timestamptz AND i.deadline < ${to}::timestamptz)
      )
    ORDER BY COALESCE(i.starts_at, i.deadline)
  `;

  return rows.map((r) => ({
    id: r.id,
    spaceId: r.space_id,
    spaceName: r.space_name,
    spaceColor: r.space_color,
    title: r.title,
    startsAt: r.starts_at?.toISOString() ?? null,
    endsAt: r.ends_at?.toISOString() ?? null,
    deadline: r.deadline?.toISOString() ?? null,
    priority: (r.priority as Priority) ?? null,
  }));
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
  const { userId, groups, minPriority, limit = 20 } = params;

  // Build priority filter
  let priorityCondition = sql``;
  if (minPriority) {
    const priorityOrder = { urgent: 1, high: 2, medium: 3, low: 4 };
    const minOrder = priorityOrder[minPriority];
    const allowedPriorities = Object.entries(priorityOrder)
      .filter(([_, order]) => order <= minOrder)
      .map(([p]) => p);
    priorityCondition = sql`AND i.priority IN ${sql(allowedPriorities)}`;
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
         OR a.group_cn = ANY(${toPgTextArray(groups)}::text[])
         OR (${userId}::uuid IS NOT NULL AND a.authenticated_only = true)
         OR (a.user_id IS NULL AND a.group_cn IS NULL AND a.authenticated_only = false)
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
 * Check for overlapping items using PostgreSQL function
 */
export const checkOverlap = async (params: {
  groups: string[];
  from: string;
  to: string;
  excludeItemId?: string;
}): Promise<OverlapItem[]> => {
  const { groups, from, to, excludeItemId } = params;

  if (groups.length === 0) return [];

  const rows = await sql<DbOverlapItem[]>`
    SELECT item_id, space_id, space_name, title, starts_at, ends_at
    FROM spaces.check_overlap(${groups}, ${from}::timestamptz, ${to}::timestamptz, ${excludeItemId ?? null})
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
