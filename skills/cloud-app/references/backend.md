# Backend Patterns — Detailed Reference

## SQL Patterns

### Import Convention

Always import `sql` directly from `"bun"`:

```typescript
import { sql } from "bun";
```

Never use an ORM or query builder. The `sql` template tag provides parameterized queries with full TypeScript support.

### Basic Queries

```typescript
type DbRow = Record<string, unknown>;

// Select with type hint
const rows = await sql<DbRow[]>`SELECT * FROM my_app.items WHERE id = ${id}`;

// Insert with RETURNING
const [created] = await sql<DbRow[]>`
  INSERT INTO my_app.items (title, description)
  VALUES (${data.title}, ${data.description})
  RETURNING *
`;

// Update
await sql`UPDATE my_app.items SET title = ${title} WHERE id = ${id}`;

// Delete
await sql`DELETE FROM my_app.items WHERE id = ${id}`;
```

### Dynamic WHERE Clauses

Build conditions as an array and reduce them:

```typescript
import { toPgTextArray, toPgUuidArray, escapeLikePattern } from "@valentinkolb/cloud/services";

const conditions: any[] = [sql`TRUE`];  // start with TRUE so AND chaining always works

if (filter.status) {
  conditions.push(sql`status = ${filter.status}`);
}
if (filter.ids?.length) {
  conditions.push(sql`id = ANY(${toPgUuidArray(filter.ids)}::uuid[])`);
}
if (filter.tags?.length) {
  conditions.push(sql`tags && ${toPgTextArray(filter.tags)}::text[]`);
}
if (filter.search) {
  const pattern = `%${escapeLikePattern(filter.search.toLowerCase())}%`;
  conditions.push(sql`(
    LOWER(title) LIKE ${pattern} ESCAPE '\\'
    OR LOWER(description) LIKE ${pattern} ESCAPE '\\'
  )`);
}

const where = conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`);

const rows = await sql<DbRow[]>`
  SELECT * FROM my_app.items
  WHERE ${where}
  ORDER BY created_at DESC
  LIMIT ${perPage} OFFSET ${offset}
`;
```

### Pagination

Always use the shared helpers from `@valentinkolb/cloud/contracts`:

```typescript
import { parsePagination, createPagination, type PaginationParams } from "@valentinkolb/cloud/contracts";

// In route handler — parse from query params
const pagination = parsePagination(c.req.valid("query"));

// In service — use pagination params
const list = async (pagination: PaginationParams, filter?: Filter) => {
  const { offset, perPage } = pagination;

  const [countRows, dataRows] = await Promise.all([
    sql<DbRow[]>`SELECT COUNT(*)::int AS total FROM my_app.items WHERE ${where}`,
    sql<DbRow[]>`SELECT * FROM my_app.items WHERE ${where} ORDER BY created_at DESC LIMIT ${perPage} OFFSET ${offset}`,
  ]);

  return {
    items: dataRows.map(mapRow),
    total: countRows[0]?.total ?? 0,
  };
};

// In route handler — build response
const { items, total } = await myService.items.list(pagination, filter);
return c.json({ items, pagination: createPagination(pagination, total) });
```

### JSONB Columns

```typescript
// Insert JSON
await sql`
  INSERT INTO my_app.entries (title, metadata)
  VALUES (${title}, ${metadata ? JSON.stringify(metadata) : null}::jsonb)
`;

// Query JSON fields
const rows = await sql`
  SELECT *, metadata->>'category' AS category
  FROM my_app.entries
  WHERE metadata->>'status' = ${status}
`;
```

### Common Table Expressions (CTEs)

For complex aggregation queries:

```typescript
const rows = await sql<DbRow[]>`
  WITH item_stats AS (
    SELECT category_id, COUNT(*)::int AS item_count
    FROM my_app.items
    GROUP BY category_id
  ),
  recent AS (
    SELECT DISTINCT ON (category_id) *
    FROM my_app.items
    ORDER BY category_id, created_at DESC
  )
  SELECT
    c.id, c.name,
    COALESCE(s.item_count, 0) AS item_count,
    r.title AS most_recent_title
  FROM my_app.categories c
  LEFT JOIN item_stats s ON s.category_id = c.id
  LEFT JOIN recent r ON r.category_id = c.id
  ORDER BY c.name
`;
```

### Recursive Queries (Group Hierarchies)

```typescript
const rows = await sql<DbRow[]>`
  WITH RECURSIVE members AS (
    SELECT ug.user_id, ug.group_id, 1 AS depth
    FROM auth.user_groups_v2 ug
    WHERE ug.group_id = ${groupId}

    UNION ALL

    SELECT ug.user_id, ug.group_id, m.depth + 1
    FROM auth.user_groups_v2 ug
    JOIN auth.group_groups_v2 gg ON gg.child_group_id = ug.group_id
    JOIN members m ON m.group_id = gg.parent_group_id
    WHERE m.depth < 10
  )
  SELECT DISTINCT u.* FROM members m
  JOIN auth.users u ON u.id = m.user_id
`;
```

### Postgres Helper Utilities

From `@valentinkolb/cloud/services`:

```typescript
// Array escaping for ANY() queries
toPgUuidArray(["uuid1", "uuid2"])  // → "{uuid1,uuid2}"
toPgTextArray(["a", "b"])          // → "{\"a\",\"b\"}"  (properly escaped)

// LIKE pattern escaping
escapeLikePattern("hello%world")   // → "hello\\%world"

// JSON parsing (import via @valentinkolb/cloud/services/postgres, not the barrel)
import { parsePgJsonValue, parsePgJsonRecord } from "@valentinkolb/cloud/services/postgres";
parsePgJsonValue(row.metadata)     // safely parses JSON string, returns null on failure
parsePgJsonRecord(row.config)      // parses as Record<string, unknown>
```

## Migration Patterns

### Schema Creation

Each app creates its own schema in `migrate.ts`:

```typescript
// migrate.ts
import { sql } from "bun";

export const migrate = async () => {
  await sql`CREATE SCHEMA IF NOT EXISTS my_app`.simple();
  console.log("  ✓ my_app schema");

  await sql`
    CREATE TABLE IF NOT EXISTS my_app.items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  console.log("  ✓ my_app.items table");

  await sql`CREATE INDEX IF NOT EXISTS idx_items_owner ON my_app.items (owner_id)`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_items_status ON my_app.items (status)`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_items_created ON my_app.items (created_at DESC)`.simple();

  // GIN index for JSONB queries
  await sql`CREATE INDEX IF NOT EXISTS idx_items_metadata ON my_app.items USING GIN (metadata)`.simple();
};
```

### Lifecycle Hook

```typescript
// index.ts
import { app } from "./config";
import { migrate } from "./migrate";

export default await app.start({
  // ...
  lifecycle: {
    setup: async () => { await migrate(); },
    start: async (ctx) => { /* background jobs, subscriptions */ },
    stop: async (ctx) => { /* cleanup */ },
  },
});
```

**Important:** Migrations must be **idempotent** — they run on every app startup. Use `IF NOT EXISTS` and `.simple()` for all DDL statements.

**Warning:** Never add and drop temporary columns in migrations. PostgreSQL counts dropped columns towards the maximum column limit (1600). Repeated add/drop cycles across deployments can exhaust this limit even though the visible column count is low.

### Adding Columns to Existing Tables

```typescript
await sql`ALTER TABLE my_app.items ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 0`.simple();
```

## Access Control (ResourceAccessAdapter)

If your app needs fine-grained permissions, use the platform's principal-based access system. Don't query `auth.access` directly — use the helpers from `@valentinkolb/cloud/server`:

```typescript
import {
  createAccess, getAccess, updateAccess, deleteAccess,
  getEffectivePermission, hasPermission,
  type ResourceAccessAdapter, type Principal, type PermissionLevel,
} from "@valentinkolb/cloud/server";
```

### How It Works

1. **Create an app-specific junction table** linking your resources to `auth.access` entries:

```sql
CREATE TABLE IF NOT EXISTS my_app.item_access (
  item_id UUID NOT NULL REFERENCES my_app.items(id) ON DELETE CASCADE,
  access_id UUID NOT NULL REFERENCES auth.access(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, access_id)
);
```

2. **Implement a ResourceAccessAdapter** for your resource type:

```typescript
const itemAccess: ResourceAccessAdapter = {
  list: async (itemId) => { /* query junction + auth.access, return AccessEntry[] */ },
  add: async (itemId, accessId) => { /* insert into junction, return Result<void> */ },
  remove: async (itemId, accessId) => { /* delete from junction, return Result<void> */ },
  count: async (itemId) => { /* count entries */ },
};
```

3. **Check permissions** in route handlers — first load access IDs, then resolve permission:

```typescript
// Load access entry IDs for the resource
const entries = await itemAccess.list(itemId);
const accessIds = entries.map((e) => e.id);

// Resolve effective permission for this user
const permission = await getEffectivePermission({
  accessIds,
  userId: user.id,
  userGroups: user.memberofGroupIds,
});

if (!hasPermission(permission, "write")) {
  return c.json({ message: "Forbidden" }, 403);
}
```

See `packages/contacts/src/service/access.ts` for a complete real-world implementation.

### Permission Levels

`'none'` < `'read'` < `'write'` < `'admin'` — `getEffectivePermission()` returns the highest level across all matching principals (direct user, group memberships, authenticated-only entries).

## Hono API Patterns

### Route Structure

```
api.ts           → main router, mounts sub-routers, applies global middleware
api/items.ts     → resource-specific routes
api/categories.ts
```

### Response Pattern

Use `respond()` for service calls that return `Result<T>`:

```typescript
import { respond, ok } from "@valentinkolb/cloud/server";

// Direct result
async (c) => respond(c, ok(data))

// Async function returning result
async (c) => respond(c, async () => {
  const result = await service.doSomething(input);
  return result;  // Result<T>
})

// With custom success status
async (c) => respond(c, () => service.create(input), 201)
```

### Error Handling with Result<T>

```typescript
import { ok, fail, err } from "@valentinkolb/cloud/server";

const create = async (data: Input): Promise<Result<Item>> => {
  if (!isValid(data)) {
    return fail(err.badInput("Title is required"));
  }
  const rows = await sql<DbRow[]>`INSERT INTO ... RETURNING *`;
  return ok(mapRow(rows[0]));
};

// Error constructors from err:
// err.badInput(message)     → 400
// err.unauthenticated(msg)  → 401
// err.forbidden(msg)        → 403
// err.internal(msg)         → 500
// Or manual: fail({ code: "NOT_FOUND", message: "...", status: 404 })
```

### OpenAPI Documentation

Every API route should have `describeRoute()` (re-exported as
`middleware.openapi()`) so the spec stays accurate:

```typescript
import { describeRoute } from "hono-openapi";
import { jsonResponse } from "@valentinkolb/cloud/server";

.get(
  "/:id",
  describeRoute({
    tags: ["Items"],
    summary: "Get item by ID",
    responses: {
      200: jsonResponse(ItemSchema, "Item found"),
      404: jsonResponse(ErrorResponseSchema, "Item not found"),
    },
  }),
  v("param", z.object({ id: z.string().uuid() })),
  async (c) => respond(c, () => service.get(c.req.valid("param").id)),
)
```

Apps don't ship a per-app docs UI. Instead, opt in to the platform
aggregator via two paired options:

```typescript
// config.ts
defineApp({
  openapi: "/api/my-app/openapi.json",  // URL where the spec is served
  ...
});

// index.ts
import apiRoutes from "./api";
const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  ...
  .route("/api/my-app", apiRoutes);

await app.start({
  fetch: router.fetch,
  openapi: apiRoutes,                   // bare api router for spec generation
});
```

`defineApp` generates the spec from the passed router at boot, mounts
it on the framework server before any auth middleware (so it's public),
and advertises the URL through the Redis registry. The api-docs app at
`/app/api-docs` aggregates every advertised spec into one Scalar UI;
new apps appear in the source switcher within ~5 s of their first
heartbeat — no api-docs restart, no manual registration.

Skip both `openapi` fields for apps without a public API surface
(pages-only apps like `tools`, `dashboard`, `ui-lab`).

### Rate Limiting

```typescript
import { rateLimit } from "@valentinkolb/cloud/server";

const app = new Hono()
  .use(rateLimit())  // default config
  .use(rateLimit({
    limitPerSecond: 10,
    windowSecs: 60,
    keyBy: "user",       // "auto" | "ip" | "user"
    routes: [
      { method: "POST", path: "/heavy", limitPerSecond: 2 },
    ],
  }))
```

## Structuring Larger Services

### Service Facade Pattern

For apps with multiple resources, split the service into one file per domain and aggregate via a facade in `service/index.ts`:

```
service/
├── index.ts          # Facade — exports unified namespaced object
├── items.ts          # Item CRUD + filtering
├── columns.ts        # Kanban column management
├── tags.ts           # Tag CRUD
├── comments.ts       # Item-scoped comments
├── access.ts         # Permission / ACL layer
├── rank.ts           # Shared ranking utility
└── types.ts          # Shared DB types (optional, or define per module)
```

```typescript
// service/index.ts
import { spaces } from "./spaces";
import { items } from "./items";
import { columns } from "./columns";
import { tags } from "./tags";
import { comments } from "./comments";
import * as access from "./access";

export const spacesService = {
  space: spaces,
  item: items,
  column: columns,
  tag: tags,
  comment: comments,
  access,
} as const;
```

Each module defines its own local `Db*` types that mirror the Postgres columns, then maps to public API types via a private mapper function. This keeps the data layer separate from the API contract:

```typescript
// service/items.ts
type DbItem = Record<string, unknown>;

const mapToItem = (row: DbItem): Item => ({
  id: row.id as string,
  title: row.title as string,
  priority: row.priority as string,
  completedAt: row.completed_at ? (row.completed_at as Date).toISOString() : null,
  // ...
});
```

### Batch Loading (N+1 Prevention)

When items have relations (tags, assignees, etc.), load them in bulk instead of per-item:

```typescript
const getTagsByItemIds = async (itemIds: string[]) => {
  const rows = await sql<DbRow[]>`
    SELECT it.item_id, t.id, t.name, t.color
    FROM my_app.item_tags it
    JOIN my_app.tags t ON it.tag_id = t.id
    WHERE it.item_id = ANY(${toPgUuidArray(itemIds)}::uuid[])
  `;

  // Group by item ID
  const map = new Map<string, Tag[]>();
  for (const row of rows) {
    const itemId = row.item_id as string;
    if (!map.has(itemId)) map.set(itemId, []);
    map.get(itemId)!.push(mapTag(row));
  }
  return map;
};

// Usage: hydrate a list of items with their tags
const hydrateRelations = async (items: Item[]) => {
  const ids = items.map((i) => i.id);
  const [tagsMap, assigneesMap] = await Promise.all([
    getTagsByItemIds(ids),
    getAssigneesByItemIds(ids),
  ]);
  return items.map((item) => ({
    ...item,
    tags: tagsMap.get(item.id) ?? [],
    assignees: assigneesMap.get(item.id) ?? [],
  }));
};
```

### Permission Guards in API Routes

For apps with access control, define a reusable guard helper instead of repeating permission logic in every route:

```typescript
// api/index.ts (or a shared helpers file)
const checkAccess = async (
  c: Context,
  resourceId: string,
  required: PermissionLevel = "read",
) => {
  const user = c.get("user");
  const entries = await myService.access.list(resourceId);
  const accessIds = entries.map((e) => e.id);

  const permission = await getEffectivePermission({
    accessIds,
    userId: user.id,
    userGroups: user.memberofGroupIds,
  });

  if (!hasPermission(permission, required)) {
    return c.json({ message: "Forbidden" }, 403);
  }
  return null; // access granted
};

// Usage in routes:
.patch("/:id", ..., async (c) => {
  const denied = await checkAccess(c, c.req.valid("param").id, "write");
  if (denied) return denied;
  // ... proceed with mutation
})
```

### Nested Resource Routes

For sub-resources (e.g. comments on items in a space), use nested path parameters and validate ownership:

```typescript
// api/comments.ts
const app = new Hono<AuthContext>()
  .get(
    "/:id/items/:itemId/comments",
    v("param", z.object({ id: z.string().uuid(), itemId: z.string().uuid() })),
    async (c) => {
      const { id, itemId } = c.req.valid("param");
      const denied = await checkAccess(c, id, "read");
      if (denied) return denied;

      // Validate item belongs to space
      const item = await myService.item.get(itemId);
      if (!item || item.spaceId !== id) return c.json({ message: "Not found" }, 404);

      const comments = await myService.comment.list(itemId);
      return c.json({ comments });
    },
  );
```

### PostgreSQL Functions in Migrations

For complex server-side logic (e.g. overlap detection, ranking), define PostgreSQL functions in `migrate.ts`:

```typescript
await sql`
  CREATE OR REPLACE FUNCTION my_app.check_overlap(
    p_start TIMESTAMPTZ,
    p_end TIMESTAMPTZ,
    p_exclude_item_id UUID DEFAULT NULL
  )
  RETURNS TABLE(item_id UUID, title TEXT, starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ)
  LANGUAGE SQL STABLE AS $$
    SELECT id, title, starts_at, ends_at
    FROM my_app.items
    WHERE starts_at IS NOT NULL AND ends_at IS NOT NULL
      AND tstzrange(starts_at, ends_at, '[]') && tstzrange(p_start, p_end, '[]')
      AND (p_exclude_item_id IS NULL OR id != p_exclude_item_id)
  $$
`.simple();

// Pair with a GIST index for performance:
await sql`
  CREATE INDEX IF NOT EXISTS idx_items_time_range
  ON my_app.items USING GIST (tstzrange(starts_at, ends_at, '[]'))
  WHERE starts_at IS NOT NULL AND ends_at IS NOT NULL
`.simple();
```

### Rollback Pattern for Multi-Step Mutations

When a mutation spans multiple tables (e.g. creating an access entry then linking it), roll back on partial failure:

```typescript
const grantAccess = async (resourceId: string, principal: Principal, permission: PermissionLevel) => {
  // Step 1: create in auth.access
  const created = await createAccess({ principal, permission });
  if (!created.ok) return created;

  // Step 2: link to resource junction table
  const linked = await addResourceAccess(resourceId, created.data.id);
  if (!linked.ok) {
    // Rollback step 1
    await deleteAccess({ id: created.data.id });
    return linked;
  }

  return ok(created.data);
};
```

## Logging Best Practices

```typescript
import { logger } from "@valentinkolb/cloud/services";

const log = logger("my-app:items");  // source format: "app:module"

log.info("Item created", { id: item.id, userId });
log.warn("Rate limit approaching", { userId, remaining: 5 });
log.error("Failed to process", { error: err.message, itemId });
```

Logs are written to both console and `logging.entries` table (fire-and-forget).
