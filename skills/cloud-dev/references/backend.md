# Backend: services, SQL, and APIs

## Service layer

All business logic lives in the service. Routes validate input, call the service, and return the result — nothing else.

Services are **stateless namespaced objects** of async functions. No classes, no constructor injection, no ORM.

```typescript
// service/items.ts
import { sql } from "bun";
import { ok, fail, err, type Result } from "@valentinkolb/stdlib";
import { logger, escapeLikePattern } from "@valentinkolb/cloud/services";

const log = logger("my-app:items");

type DbRow = Record<string, unknown>;

const mapRow = (row: DbRow): Item => ({
  id: row.id as string,
  title: row.title as string,
  createdAt: (row.created_at as Date).toISOString(),
});

export const items = {
  create: async (data: CreateItem): Promise<Result<Item>> => {
    const rows = await sql<DbRow[]>`
      INSERT INTO my_app.items (title, description)
      VALUES (${data.title}, ${data.description})
      RETURNING *
    `;
    if (!rows[0]) return fail(err.internal("Insert failed"));
    log.info("Item created", { id: rows[0].id });
    return ok(mapRow(rows[0]));
  },
};
```

Conventions: import `sql` directly from `"bun"`; declare `type DbRow = Record<string, unknown>` and cast inside a mapper; return `Result<T>` from anything that can fail.

The `Result` model is stdlib's. `ok`, `fail`, and `err` are re-exported by `@valentinkolb/cloud/server` for convenience.

```typescript
err.badInput(why)          // 400
err.unauthenticated(why)   // 401
err.forbidden(why)         // 403
err.notFound(what)         // 404
err.conflict(what)         // 409
err.internal(why)          // 500
```

### Facade for larger apps

Split one file per domain and aggregate:

```typescript
// service/index.ts
export const myAppService = {
  item: items,
  tag: tags,
  comment: comments,
  access,
} as const;
```

Each module defines its own local `Db*` types mirroring the Postgres columns and maps to the public API type through a private mapper. That keeps the data layer independent of the API contract.

## SQL

### Dynamic conditions

Build an array and reduce it. Start with `TRUE` so `AND` chaining always works:

```typescript
import { toPgTextArray, toPgUuidArray, escapeLikePattern } from "@valentinkolb/cloud/services";

const conditions: any[] = [sql`TRUE`];

if (filter.status) conditions.push(sql`status = ${filter.status}`);
if (filter.ids?.length) conditions.push(sql`id = ANY(${toPgUuidArray(filter.ids)}::uuid[])`);
if (filter.tags?.length) conditions.push(sql`tags && ${toPgTextArray(filter.tags)}::text[]`);
if (filter.search) {
  const pattern = `%${escapeLikePattern(filter.search.toLowerCase())}%`;
  conditions.push(sql`LOWER(title) LIKE ${pattern} ESCAPE '\\'`);
}

const where = conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`);
```

Helpers from `@valentinkolb/cloud/services`: `toPgUuidArray`, `toPgTextArray`, `escapeLikePattern`. JSON parsing helpers `parsePgJsonValue` and `parsePgJsonRecord` import from `@valentinkolb/cloud/services/postgres` rather than the barrel.

### Batch loading

Load relations in bulk; never per item.

```typescript
const getTagsByItemIds = async (itemIds: string[]) => {
  const rows = await sql<DbRow[]>`
    SELECT it.item_id, t.id, t.name FROM my_app.item_tags it
    JOIN my_app.tags t ON it.tag_id = t.id
    WHERE it.item_id = ANY(${toPgUuidArray(itemIds)}::uuid[])
  `;
  const map = new Map<string, Tag[]>();
  for (const row of rows) {
    const id = row.item_id as string;
    if (!map.has(id)) map.set(id, []);
    map.get(id)!.push(mapTag(row));
  }
  return map;
};
```

### Never authorize with a local query

Do not write an app-local recursive CTE over `auth.user_groups_v2` to decide access. Resource permissions go through `getEffectivePermission()` or `buildAccessPrincipalCondition()` so nested membership resolves identically in every app. See `auth.md`.

## Pagination — two helpers, two shapes

These are **not** interchangeable. Mixing them means your API returns two different pagination envelopes.

**SQL-backed lists** use `@valentinkolb/cloud/contracts`. `parsePagination` produces the `offset` for `LIMIT`/`OFFSET`; `createPagination` produces the snake_case HTTP envelope `{ page, per_page, total, total_pages, has_next }`:

```typescript
import { parsePagination, createPagination, PaginationQuerySchema } from "@valentinkolb/cloud/contracts";

const pagination = parsePagination(c.req.valid("query"));

const [countRows, dataRows] = await Promise.all([
  sql<DbRow[]>`SELECT COUNT(*)::int AS total FROM my_app.items WHERE ${where}`,
  sql<DbRow[]>`SELECT * FROM my_app.items WHERE ${where} ORDER BY created_at DESC
               LIMIT ${pagination.perPage} OFFSET ${pagination.offset}`,
]);

return c.json({
  items: dataRows.map(mapRow),
  pagination: createPagination(pagination, countRows[0]?.total ?? 0),
});
```

**Already-loaded arrays** use `paginateItems` from `@valentinkolb/cloud/server`, which slices in memory and returns stdlib's camelCase `Paginated<T>` — `{ items, page, perPage, total, hasNext }`. Use it when the full set is already in memory (an external API response, a computed list), never as a substitute for `LIMIT`/`OFFSET` on a real table.

Both are in active use. Pick by data source, and keep one shape per endpoint.

## Migrations

Each app owns its schema. `migrate.ts` runs from `lifecycle.setup()` on **every** startup, so every statement must be idempotent.

```typescript
import { sql } from "bun";

export const migrate = async () => {
  await sql`CREATE SCHEMA IF NOT EXISTS my_app`.simple();

  await sql`
    CREATE TABLE IF NOT EXISTS my_app.items (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      title      TEXT NOT NULL,
      metadata   JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();

  await sql`CREATE INDEX IF NOT EXISTS idx_items_owner ON my_app.items (owner_id)`.simple();
  await sql`ALTER TABLE my_app.items ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 0`.simple();
};
```

Use `.simple()` for DDL.

> **Never add and then drop a column.** Postgres counts dropped columns against the 1600-column limit. Repeated add/drop cycles across deployments exhaust it even though the visible column count stays small.

### Deleting large resource trees

A single multi-GB `ON DELETE CASCADE` can hold locks long enough to stall the app. Keep the cascades as a safety net, but drain the big children deliberately:

1. In the request: verify access, mark the parent as deleting, disable new writers, enqueue a durable `@valentinkolb/sync` job.
2. In the job: delete the largest child tables in bounded batches (`LIMIT 50000` over `ctid`).
3. Reschedule after each non-empty batch so leases stay short and work resumes after a crash.
4. Delete the parent only once the large children are drained.

Keep the job idempotent — a retry continues from database state, never from process memory. Redis and process-local state are not the source of truth for destructive work.

## Hono routes

```typescript
// api/index.ts
import { Hono } from "hono";
import { rateLimit } from "@valentinkolb/cloud/server";
import itemsRoutes from "./items";

const app = new Hono()
  .use(rateLimit())
  .route("/items", itemsRoutes);

export default app;
export type ApiType = typeof app;   // ← powers the typed frontend client
```

> Export the **final chained** router. Exporting an earlier base router silently drops endpoints from the generated client, with no type error.

```typescript
// api/items.ts
const app = new Hono<AuthContext>()
  .use(auth.requireRole("authenticated"))
  .get(
    "/:id",
    describeRoute({
      tags: ["Items"],
      summary: "Get item by id",
      responses: {
        200: jsonResponse(ItemSchema, "Item found"),
        404: jsonResponse(ErrorResponseSchema, "Not found"),
      },
    }),
    v("param", z.object({ id: z.string().uuid() })),
    async (c) => respond(c, () => items.get(c.req.valid("param").id)),
  )
  .post("/", v("json", CreateItemSchema), async (c) =>
    respond(c, () => items.create(c.req.valid("json")), 201),
  );
```

- `v("json" | "query" | "param" | "header", Schema)` validates input.
- `respond(c, result)` converts `Result<T>` to an HTTP response; pass a success status as the third argument.
- `describeRoute()` + `jsonResponse()` generate OpenAPI.
- `rateLimit({ limitPerSecond, windowSecs, keyBy: "auto" | "ip" | "user", routes })` for per-route limits.

### Keep the client's types strong

Avoid broad `Response` branches in JSON APIs. A single `new Response(JSON.stringify(...))` can widen the generated client body to `unknown` or an unusable union. Raw `Response` is correct for streams, blobs, downloads, and proxying.

If migrating a frontend to the typed client requires `any` or `response.json() as Type`, **stop and fix the route typing** — the cast hides a real defect.

```typescript
// api/client.ts
import { api } from "@valentinkolb/cloud/browser";
import type { ApiType } from ".";

export const apiClient = api.create<ApiType>({ baseUrl: "/api/my-app" });
```

Sub-routes resolve automatically: `apiClient.widget.today.$get()` hits `/api/my-app/widget/today`.

### OpenAPI

Opt into the platform aggregator with two paired options — `defineApp({ openapi: "/api/my-app/openapi.json" })` and `app.start({ openapi: apiRoutes })`. The framework generates the spec from that router at boot, mounts it before any auth middleware so it is public, and advertises the URL through the registry. The api-docs app picks it up within seconds of the first heartbeat. Skip both fields for apps with no public API surface.

### Long-lived SSE

An SSE endpoint must send its first event immediately and then keepalives frequently, or an idle connection can be cancelled while a topic subscription is blocked — which surfaces as a confusing secondary stream-cancellation error during cleanup. Cloud's AI stream helper uses a 5-second heartbeat; match that order of magnitude.

## Authorization and audit

Route middleware is a page-level gate, not the authorization boundary. For security-relevant mutations, the **service** that performs the mutation makes the decision, and route checks remain defence in depth.

**Design service signatures around `actor` and `accessSubject`, never around `User`.** A service that takes a `User` cannot serve a resource-bound API key or an OAuth service token, and `c.get("user")` is `undefined` for those despite its type. Widening such a signature later means touching every call site — take the pair from the start:

```typescript
const result = await myService.items.update({
  id,
  input,
  actor: c.get("actor"),
  accessSubject: c.get("accessSubject"),
});
```

A reusable guard beats repeating the check in every route:

```typescript
const checkAccess = async (c: Context, resourceId: string, required: PermissionLevel = "read") => {
  const entries = await myService.access.list(resourceId);
  const permission = await getEffectivePermission({
    accessIds: entries.map((e) => e.id),
    subject: c.get("accessSubject"),
  });
  if (!hasPermission(permission, required)) return c.json({ message: "Forbidden" }, 403);
  return null;
};

.patch("/:id", async (c) => {
  const denied = await checkAccess(c, c.req.valid("param").id, "write");
  if (denied) return denied;
  // …
});
```

### Audit

```typescript
import { audit } from "@valentinkolb/cloud/services";
```

> **`audit.deny()` is not a guard — it always returns a failed `Result`.** It records a denial and constructs the response. Call it *after* you have decided to deny, inside the branch. Writing `const denied = await audit.deny(...); if (denied) return denied;` makes the branch unconditional and the mutation unreachable.

```typescript
if (!hasPermission(permission, "admin")) {
  return audit.deny({
    action: "my_app.resource.delete",
    actor: { userId: user.id, uid: user.uid, provider: user.provider, roles: user.roles },
    target: { type: "resource", id: resource.id, label: resource.title },
    message: "Admin access required",
  });
}

const result = await deleteResource(resource.id);
return audit.recordResult({
  action: "my_app.resource.delete",
  actor: { userId: user.id, uid: user.uid, provider: user.provider, roles: user.roles },
  target: { type: "resource", id: resource.id, label: resource.title },
  metadata: { source: "admin_page" },
  result,
});
```

Audit metadata stays small and non-secret: identifiers, changed field names, provider, request id, booleans. Never passwords, raw tokens, cookies, `ipa_session` values, or full request bodies.

## Global Search provider

Opt in through `app.start({ capabilities: { search } })`. The gateway aggregates every registered provider.

```typescript
capabilities: {
  search: {
    tags: ["items"],                 // optional filter tags the user can type
    help: "Search items by title",
    run: async ({ query, tags, limit, ctx }): Promise<AppSearchResult[]> => {
      const user = ctx.get("user");
      const rows = await myService.items.search({ query, limit, userId: user.id });
      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        href: `/app/my-app/${row.id}`,
        icon: "ti ti-star",
        preview: row.summary,
      }));
    },
  },
}
```

`AppSearchResult` requires `id`, `title`, and `href`; `preview`, `icon`, `priority`, `metadata`, and `previewUrl` are optional.

Three rules the framework will not enforce for you:

- **Apply the user's permissions inside the query.** The dispatcher authenticates; it does not filter your rows. A provider that returns everything leaks everything.
- **Respect `limit`.** Results from all apps are merged; an app that ignores it crowds out every other app.
- **Honour `tags`** if you declared any, so a tag-filtered search does not silently return unfiltered results.

Global Search is **user-backed only**. Core rejects resource-bound service accounts before provider fanout, so `ctx.get("user")` is safe to assume here — and this is the one place that assumption is correct. Do not add resource-service-account handling to a search provider.

## Settings

```typescript
import * as settings from "@valentinkolb/cloud/services/settings";

const enabled = await settings.get<boolean>("my-app.feature_enabled");
await settings.set("logs.retention_days", 60);
```

All `settings.*` reads are async and go through a Redis cache-aside layer with a 5-minute TTL.

**Inside an HTTP handler, prefer the per-request snapshot** on `c.get("settings")` — sync, frozen for the request, populated by `middleware.settings()`, and it avoids a Redis round trip on every read. Keys declared in `defineApp({ settings })` are typed on it for routes using `Hono<AppContext<typeof app>>`.

The snapshot's stability is deliberate: it is taken once and **will not change mid-request**, so a handler cannot observe a value flipping halfway through its own work. Do not write code that expects it to update, and do not poll settings to "stay fresh" — a write in any container deletes the shared cache key, so the next request already sees the new value.

Fall back to the async getter outside the request lifecycle: background jobs, lifecycle hooks, schedulers.

### Timezones

Store user-facing instants as UTC. Date-only values stay `YYYY-MM-DD`.

```typescript
import { getDateConfig, getTimeZone } from "@valentinkolb/cloud/server";

const dateConfig = getDateConfig(c);  // stdlib DateContext — pass into time-aware islands
const timeZone = getTimeZone(c);      // string, mostly for logs and jobs
```

Resolution order is the browser `cloud.timezone` cookie, then the `app.timezone` setting, then UTC. Background jobs have no cookie, so they use `app.timezone`.

Format through `@valentinkolb/stdlib` date helpers with that context. Do not use bare `Date#getHours()` for user-facing values, and do not add app-local timezone stores or wrapper formatters.

## Logging and traces

```typescript
import { logger, trace } from "@valentinkolb/cloud/services";

const log = logger("my-app:items");   // source format: "app:module"
log.info("Item created", { id, userId });
```

Entries go to the console and to `logging.entries` (fire-and-forget), with retention-based cleanup.

`trace` records background-job observability metadata and powers `/admin/observability/jobs`. It is **not** a job wrapper: it must not change queueing, locking, retries, or permission decisions.

Jobs and schedules themselves are `@valentinkolb/sync` — see the `sync` skill for `job`, `scheduler`, and their options. The snippet below is an **integration example only**: what matters here is where Cloud's `trace` adapters and the required `meta` plug in.

```typescript
const cleanupJob = job<void, { deleted: number }>({
  id: "my-app:cleanup",
  trace: trace.fromSyncJob({ name: "My app cleanup", source: "my-app:cleanup", appId: "my-app" }),
  process: async () => ({ deleted: await cleanupOldRows() }),
});

await scheduler({ id: "my-app" }).create({
  id: "my-app:cleanup",
  cron: "0 4 * * *",
  meta: { appId: "my-app", family: "my-app:maintenance", label: "My app cleanup", source: "my-app:cleanup" },
  trace: trace.fromSyncSchedule({ name: "My app cleanup schedule", source: "my-app:cleanup", appId: "my-app" }),
  process: async ({ ctx }) => { await cleanupJob.submit({ key: `slot:${ctx.slotTs}` }); },
});
```

**Schedule `meta` is required** — Gateway Ops discovers schedules through sync's `schedulerControl` and joins runtime stats by `meta.source`. Add `resourceLabel` for dynamic per-resource schedules. Do **not** add an app-local admin "run now" endpoint; admins trigger scheduled work from `/admin/observability/jobs`.

For non-sync work, `trace.withSpan({ name, source, appId, category }, async (span) => …)` plus `trace.record(...)`.

Trace metadata stays small and non-secret: ids, counts, statuses, durations, model names, token counts, retry data. Never prompts, answers, request bodies, keys, cookies, or full tool arguments. The shape is deliberately close to OpenTelemetry so it can be exported as OTLP later.

## Notifications

Declare every end-user notification in `src/notifications.ts` and register the map through `defineApp({ notifications })`. The platform owns preferences, channel selection, durable delivery, retries, deduplication, and delivery history. The app owns the typed payload and its presentation.

```typescript
import { notification } from "@valentinkolb/cloud";
import { z } from "zod";

export const NOTIFICATIONS = {
  exportReady: notification({
    recipient: "user",
    label: "Completed exports",
    description: "A notification when an export is ready.",
    delivery: { recommended: ["browser"] },
    data: z.object({ exportId: z.uuid() }),
    render: ({ exportId }) => ({
      title: "Export ready",
      targetHref: `/app/my-app/exports/${encodeURIComponent(exportId)}`,
    }),
  }),
};
```

Send through the **bound** definition on `app.notifications` — recipient and payload types are inferred, so never cast either:

```typescript
await notifications.send(app.notifications.exportReady, {
  recipient: { userId },
  data: { exportId },
  idempotencyKey: `export:${exportId}`,
});
```

- `recommended` sets the default channel order; users override it on `/me/notifications`. `required` is only for channels the product cannot work without, such as an email sign-in link — those cannot be disabled.
- Every logical event needs a stable `idempotencyKey`. Background jobs send only after their domain state is committed, and recover missed sends from that state. Notification rows are a delivery log, not the source of truth.
- Keep browser payloads generic; put sensitive context behind the authenticated `targetHref`, and let the destination page do its own permission check.
- Apps must never request browser notification permission directly — the central settings UI owns opt-in and endpoint registration.

`notifications.sendToUser()` and the legacy email-only overload still work for third-party compatibility but are **deprecated** and warn on every call.

## Live event streams

For UI metadata that should update live but is safe to heal by reload, publish to a Redis-backed `@valentinkolb/sync` `topic()`. The topic API — construction, `pub`, `live`, cursors — belongs to the `sync` skill. What Cloud adds are the rules around it:

- **Emit from service functions, after a successful DB mutation** — never from an HTTP route. That way scripts, jobs, templates, and APIs all share one event path.
- **The database stays the only source of truth.** A missed event must be fully recoverable by a reload or a targeted refetch. If it is not, the event is carrying state it should not.
- **Never read Redis stream keys directly.** The topic API owns key shape and empty-stream handling.
- Prefer small idempotent events (`upsertItem`, `removeItem`). For bulk or uncertain changes, publish an `invalidated` event with scopes and let the client refetch a slice.

### WebSocket contract

Each app owns `/api/<app>/ws`. The gateway already proxies upgrades and forwards authentication.

- The first client message identifies the resource and the last applied cursor.
- Validate every message at runtime; bound message size and pending work.
- Resolve current resource permissions before subscribing.
- With no cursor supplied, start at `topic.latestCursor()` and return that baseline in a `ready` message.
- Recheck permission periodically and before delivering each event. On revocation, send a message and close with `1008`.
- Abort `topic.live()` and permission timers on socket close.
- Treat a failed `socket.send()` as backpressure and close with `1013`. Use `1012` for a recoverable restart — the browser helper reconnects.

**Never put session tokens in WebSocket URLs.** Same-origin browser sockets send the session cookie and the gateway forwards it.

Wire it up in `index.ts`:

```typescript
import { websocket } from "hono/bun";

const result = await app.start({ fetch: router.fetch, openapi: apiRoutes });
export default { ...result, websocket };
```

## Testing

Use `bun:test`. Prefer small pure tests; add integration tests only when a real database or browser boundary is the behaviour under test.

Test first: pure service helpers (parsers, recurrence, export builders, permission resolvers, URL serializers), frontend helpers (URL-state parsing, payload builders, client reducers), and Zod contracts for tricky input combinations.

Keep tests next to the code (`recurrence.ts` → `recurrence.test.ts`). A pure test must not import the app entrypoint, start Hono, connect to Postgres, or need Docker. If code cannot be tested without those, extract the decision logic into a pure helper and keep the transport wrapper thin.
