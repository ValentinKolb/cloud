---
name: cloud-app
description: >
  Complete guide to building apps on the StuVe Cloud platform — backend services, Hono APIs, SolidJS SSR frontend,
  UI components, and all conventions. Use this skill whenever the user wants to create a new app, add features
  to an existing app, build API routes, create frontend pages or islands, implement service logic, write SQL queries,
  set up migrations, or work with the UI component library. This is the primary skill for any app development work.
---

# Building Apps on the Cloud

This skill covers everything you need to build a complete app. For platform overview and auth concepts, see the `cloud` skill. For deployment, see `cloud-ops`.

> **Detailed references:** Backend patterns → `references/backend.md` | Frontend patterns → `references/frontend.md` | New frontend addenda → `references/add-frontend.md`

## What Belongs In An App — And What Does NOT

Apps are domain features *on top of* the platform. They must not redefine platform primitives.

**Keep out of apps** — these live in `packages/cloud/` (core):

- **Auth flows, session semantics, role/permission logic** — every container shares the same auth model. A new login flow or role type is a core change, not an app change.
- **The `auth.*` schema and anything that writes to it** — user/group/access/account-request/deleted-account tables are owned by core. Apps reference `auth.users(id)` via foreign keys; they never migrate or mutate those tables directly.
- **Account lifecycle, IPA sync, provider switching, magic-link issuance** — these are platform invariants.

The existing `accounts` app (`packages/accounts/`) is **pure admin UI** backed by `@valentinkolb/cloud/services/accounts`. It owns no schema, no service layer, no lifecycle. It exists so operators can fork or replace the admin frontend without touching auth semantics. If you find yourself wanting to add auth logic there, move it to `packages/cloud/src/services/` first — then consume it from the app.

**Good app candidates:** domain features (files, notebooks, spaces, quotes, weather), tools, reporting. Anything where swapping the app out wouldn't change how users log in or what roles mean.

## App Directory Structure

Every app follows this skeleton. Reference apps: [cloud-template](https://github.com/ValentinKolb/cloud-template) (canonical standalone reference — tenancy + items + permissions + admin + widget + email), `weather` (simple), `faq` (CRUD/admin), `contacts` (permissions/detail panels).

```
packages/my-app/
├── package.json          # workspace manifest
├── tsconfig.json         # @/* and @valentinkolb/cloud/* path aliases
├── tsconfig.typecheck.json
└── src/
    ├── index.ts              # app.start() — the entry point
    ├── config.ts             # defineApp() — identity, SSR config, settings, widgets
    ├── api/
    │   ├── index.ts          # Hono router (mounts sub-routers, exports ApiType)
    │   ├── client.ts         # Typed Hono client for frontend
    │   ├── widgets.ts        # Dashboard widget endpoints
    │   └── items.ts          # Route handlers (one file per resource)
    ├── contracts.ts          # Zod schemas for input/output validation
    ├── migrate.ts            # Database migrations (CREATE SCHEMA/TABLE IF NOT EXISTS)
    ├── service/              # Business logic (stateless functions)
    │   ├── index.ts          # Service namespace export
    │   └── items.ts
    ├── styles/
    │   └── app.css           # Tailwind entrypoint (required by CSS preloader)
    └── frontend/
        ├── index.ts          # Explicit page route mapping (SSR pages to Hono routes)
        ├── page.tsx          # Root page (SSR)
        ├── [id]/
        │   └── page.tsx      # Dynamic route page
        └── _components/
            ├── ItemList.island.tsx    # Interactive client component
            └── ItemFilters.island.tsx
```

**Also required when adding a new app:**
1. Add a service block in `compose.dev.yml` (see `cloud-ops` skill).
2. Add a `COPY packages/my-app/package.json packages/my-app/` line in `Dockerfile.dev` so the install layer caches the new workspace.

The app self-registers in the Redis app registry via `createHeartbeat()` on startup; the gateway picks it up within ~5 s. There is no central registration file.

## The App Entry Point

### config.ts — App Definition

```typescript
import { defineApp } from "@valentinkolb/cloud";

export const app = defineApp({
  id: "my-app",                          // unique, used in URLs and registry
  name: "My App",                        // display name
  icon: "ti ti-star",                    // Tabler icon class
  description: "Short description.",
  basePath: "/app/my-app",              // SSR asset URL prefix
  baseUrl: "http://app-my-app:3000",    // container URL for service registry
  adminHref: "/admin/my-app",           // optional admin page link
  nav: {
    href: "/app/my-app",                // primary nav link
    match: "/app/my-app",               // active-state path matching
    section: "primary",                  // "primary" | "more" | "hidden"
    requiresAuth: true,
    requiresRoles: ["user"],             // optional role filter
  },
  widgets: [{ id: "today", path: "/api/my-app/widget/today" }],
  settings: {
    "my-app.feature_enabled": {
      kind: "boolean",
      label: "Enable feature X",
      default: true,
      description: "Whether feature X is active.",
    },
  },
  // Opt in to the platform-wide API docs aggregator (the api-docs app at
  // /app/api-docs). Pair this with `app.start({ openapi: <api router> })`
  // — defineApp generates an OpenAPI 3.x spec from that router at boot,
  // mounts it on the framework server before the user fetch (so it's
  // public), and advertises the URL via the registry. Apps without an
  // API surface (pages-only) omit this field.
  openapi: "/api/my-app/openapi.json",
  // Top-level URL prefixes the gateway routes to this container. Standard
  // four-prefix scheme; specials list whatever they actually own.
  routes: ["/api/my-app", "/app/my-app", "/admin/my-app", "/public/my-app"],
});

export const { ssr, plugin } = app;
```

`defineApp()` creates the SSR config, Bun plugin for island bundling, and the `ssr` page handler wrapper used in page files. All app identity, widget endpoints, and per-app settings live here — one place. The `settings` map is typed: keys are exposed on `c.get("settings")` for any route using `Hono<AppContext<typeof app>>`.

### index.ts — App Bootstrap

```typescript
import { app } from "./config";
import { Hono } from "hono";
import { middleware, type AuthContext } from "@valentinkolb/cloud/server";
import apiRoutes from "./api";
import pageRoutes, { adminPages } from "./frontend";
import { myService } from "./service";
import { migrate } from "./migrate";

// Compose your own router — the framework no longer injects middleware
// implicitly. Register what you need from `middleware.*` and pass the
// resulting Hono instance's `.fetch` to `app.start()`.
const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())     // c.get("runtime") — required by Layout/Sidebar
  .use("*", middleware.settings())    // c.get("settings") — typed snapshot
  .route("/api/my-app", apiRoutes)
  .route("/app/my-app", pageRoutes)
  .route("/admin/my-app", adminPages);

export default await app.start({
  fetch: router.fetch,
  // Pair with defineApp's `openapi: "/api/my-app/openapi.json"`. The
  // framework generates the spec from this router at boot and serves it
  // at the configured URL (public, before any auth middleware).
  openapi: apiRoutes,
  lifecycle: {
    setup: async () => { await migrate(); },
    start: async (ctx) => { /* start background jobs */ },
    stop: async (ctx) => { /* cleanup */ },
  },
  capabilities: {
    search: {
      tags: ["items"],
      help: "Search items",
      run: async ({ query, tags, limit, ctx }) => {
        // return AppSearchResult[]
      },
    },
  },
});
export { myService as service };
export type { ApiType } from "./api";
```

### styles/app.css — Tailwind Entrypoint

```css
@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));
```

Required by the CSS preloader. Every app must have this file.

---

## Backend

### Service Layer

All business logic lives in the service — routes are thin wrappers that validate input, call the service, and return the result.

**Pattern:** Stateless namespaced objects with async functions.

```typescript
// service/items.ts
import { sql } from "bun";
import { ok, fail, type Result } from "@valentinkolb/stdlib";
import type { PaginationParams } from "@valentinkolb/cloud/contracts";
import { logger } from "@valentinkolb/cloud/services";
import { toPgTextArray, escapeLikePattern } from "@valentinkolb/cloud/services";

const log = logger("my-app:items");

type DbRow = Record<string, unknown>;

const mapRow = (row: DbRow): Item => ({
  id: row.id as string,
  title: row.title as string,
  createdAt: (row.created_at as Date).toISOString(),
});

export const items = {
  list: async (pagination: PaginationParams, search?: string): Promise<{ items: Item[]; total: number }> => {
    const { offset, perPage } = pagination;
    const conditions: any[] = [sql`TRUE`];

    if (search) {
      const pattern = `%${escapeLikePattern(search.toLowerCase())}%`;
      conditions.push(sql`LOWER(title) LIKE ${pattern} ESCAPE '\\'`);
    }

    const where = conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`);

    const [countRows, dataRows] = await Promise.all([
      sql<DbRow[]>`SELECT COUNT(*)::int AS total FROM my_app.items WHERE ${where}`,
      sql<DbRow[]>`SELECT * FROM my_app.items WHERE ${where} ORDER BY created_at DESC LIMIT ${perPage} OFFSET ${offset}`,
    ]);

    return { items: dataRows.map(mapRow), total: countRows[0]?.total ?? 0 };
  },

  create: async (data: CreateItem): Promise<Result<Item>> => {
    const rows = await sql<DbRow[]>`
      INSERT INTO my_app.items (title, description)
      VALUES (${data.title}, ${data.description})
      RETURNING *
    `;
    if (!rows[0]) return fail({ code: "INTERNAL", message: "Insert failed", status: 500 });
    log.info("Item created", { id: rows[0].id });
    return ok(mapRow(rows[0]));
  },
};
```

**Key conventions:**
- Import `sql` directly from `"bun"` — no ORM, no query builder
- Define `type DbRow = Record<string, unknown>` and cast in mapper functions
- Use `Result<T>` (from `@valentinkolb/stdlib`) for operations that can fail: `ok(data)` / `fail(error)`
- Services are stateless — no class instances, no constructor injection
- Use `toPgTextArray()`, `toPgUuidArray()`, `escapeLikePattern()` from `@valentinkolb/cloud/services`
- Use `ok`, `fail`, `err` from `@valentinkolb/cloud/server` (re-exported from stdlib)

### SQL Patterns

> Dynamic WHERE, CTEs, JSONB, recursive queries → `references/backend.md`

**Always use Bun's `sql` template tag** for parameterized queries:

```typescript
import { sql } from "bun";

// Simple query
const rows = await sql<DbRow[]>`SELECT * FROM my_app.items WHERE id = ${id}`;

// Dynamic conditions
const conditions: any[] = [sql`TRUE`];
if (filter.status) conditions.push(sql`status = ${filter.status}`);
if (filter.ids) conditions.push(sql`id = ANY(${toPgUuidArray(filter.ids)}::uuid[])`);
const where = conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`);

// Pagination (always use the shared helper)
import { parsePagination, createPagination } from "@valentinkolb/cloud/contracts";
const pagination = parsePagination(query);
const rows = await sql`... LIMIT ${pagination.perPage} OFFSET ${pagination.offset}`;
const paginationResult = createPagination(pagination, total);
```

### Migrations

Each app owns its own PostgreSQL schema. Migrations live in `migrate.ts` and run in `lifecycle.setup()`:

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
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.simple();
  console.log("  ✓ my_app.items table");

  await sql`CREATE INDEX IF NOT EXISTS idx_items_owner ON my_app.items (owner_id)`.simple();
  await sql`CREATE INDEX IF NOT EXISTS idx_items_created ON my_app.items (created_at DESC)`.simple();
};
```

**Convention:** Use `CREATE ... IF NOT EXISTS` and `.simple()` — migrations are idempotent and run on every startup.

**Warning:** Never add and drop temporary columns in migrations. PostgreSQL counts dropped columns towards the maximum column limit (1600). Repeated add/drop cycles across deployments can exhaust this limit even though the visible column count is low.

App-owned settings are declared inside `defineApp({ settings: { ... } })` (see § config.ts above). The platform registers them automatically; they appear in `/admin/settings` grouped by the dotted-key prefix and become typed on `c.get("settings")` for routes using `Hono<AppContext<typeof app>>`.

### Hono API Routes

```typescript
// api/index.ts
import { Hono } from "hono";
import { rateLimit } from "@valentinkolb/cloud/server";
import itemsRoutes from "./items";

const app = new Hono()
  .use(rateLimit())
  .route("/items", itemsRoutes);

export default app;
export type ApiType = typeof app;   // ← this type powers the frontend client
```

```typescript
// api/items.ts
import { Hono } from "hono";
import { auth, v, respond, ok, jsonResponse } from "@valentinkolb/cloud/server";
import { describeRoute } from "hono-openapi";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { parsePagination, createPagination, PaginationQuerySchema, PaginationResponseSchema, ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { ItemSchema, CreateItemSchema, ItemListResponseSchema } from "../contracts";
import { items } from "../service";
import { z } from "zod";

const app = new Hono<AuthContext>()
  .use(auth.requireRole("authenticated"))
  .get(
    "/",
    describeRoute({
      tags: ["Items"],
      summary: "List items",
      responses: {
        200: jsonResponse(ItemListResponseSchema, "Paginated items list"),
      },
    }),
    v("query", PaginationQuerySchema.extend({ search: z.string().optional() })),
    async (c) => {
      const query = c.req.valid("query");
      const pagination = parsePagination(query);
      const { items: data, total } = await items.list(pagination, query.search);
      return c.json({ items: data, pagination: createPagination(pagination, total) });
    },
  )
  .post(
    "/",
    describeRoute({
      tags: ["Items"],
      summary: "Create item",
      responses: {
        201: jsonResponse(ItemSchema, "Created item"),
        400: jsonResponse(ErrorResponseSchema, "Validation error"),
      },
    }),
    v("json", CreateItemSchema),
    async (c) => respond(c, () => items.create(c.req.valid("json")), 201),
  );

export default app;
```

**Key patterns:**
- `v("json", Schema)` — validates request body/query/params against Zod schema
- `respond(c, result)` — converts `Result<T>` to proper HTTP response (200 for ok, 4xx/5xx for fail)
- `describeRoute()` + `jsonResponse()` — generates OpenAPI documentation
- `auth.requireRole(...)` — protects routes (see `cloud` skill for details)
- Always export `type ApiType = typeof app` for the typed client

### Contracts (Zod Schemas)

```typescript
// contracts.ts
import { z } from "zod";
export { PaginationQuerySchema, PaginationResponseSchema, ErrorResponseSchema, parsePagination, createPagination } from "@valentinkolb/cloud/contracts";

export const ItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type Item = z.infer<typeof ItemSchema>;

export const CreateItemSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
});
export type CreateItem = z.infer<typeof CreateItemSchema>;

export const ItemListResponseSchema = z.object({
  items: z.array(ItemSchema),
  pagination: PaginationResponseSchema,
});
```

### Typed API Client

```typescript
// api/client.ts
import { api } from "@valentinkolb/cloud/browser";
import type { ApiType } from ".";

export const apiClient = api.create<ApiType>({ baseUrl: "/api/my-app" });
```

The base URL must match how routes are mounted: `app.start()` mounts API routes at `/api`, and the app mounts its sub-Hono at `/my-app`, so the full path is `/api/my-app`. Sub-routes inside `apiRoutes` (`/widget/...`, `/admin/...`, root for CRUD) are picked up by the typed client automatically — `apiClient.widget.today.$get()` resolves to `/api/my-app/widget/today`, no manual stitching.

**Always use the typed client in frontend code.** It provides full type inference for all endpoints.

---

## Frontend

### Page Routing (frontend/index.ts)

Pages are NOT auto-routed from directory structure. Each page file exports a pre-wrapped `ssr<AuthContext>(...)` handler array. The route mapping in `frontend/index.ts` simply spreads these:

```typescript
// frontend/page.tsx — page exports ssr handler directly
import { ssr } from "../config";
import type { AuthContext } from "@valentinkolb/cloud/server";

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  // ... fetch data ...
  return () => <Layout c={c} title="My Page">...</Layout>;
});
```

```typescript
// frontend/index.ts — maps routes to pages
import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/server";
import mainPage from "./page";
import detailPage from "./[id]/page";
import adminPage from "./admin";

export const adminPages = new Hono<AuthContext>()
  .get("/", auth.requireRole("admin", auth.redirectToLogin), ...adminPage);

export default new Hono<AuthContext>()
  .get("/", auth.requireRole("user", auth.redirectToLogin), ...mainPage)
  .get("/:id", auth.requireRole("user", auth.redirectToLogin), ...detailPage);
```

Auth middleware is applied per-route. The `ssr` function from `config.ts` wraps the page into a Hono middleware array that you spread into route definitions.

### SSR Pages

Pages are server-rendered async functions that return JSX.

**Important:** SSR pages call services directly on the server (no API round-trip). This is one reason for the service pattern — services are shared between API routes and SSR pages. But **be careful**: API routes have explicit access checks (auth middleware, permission checks). If an SSR page calls a service without the same checks, the user could see data they shouldn't. Always verify permissions in SSR pages too, not just in API routes.

```typescript
// frontend/page.tsx
import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { Pagination } from "@valentinkolb/cloud/ui";
import { parsePagination, createPagination } from "@valentinkolb/cloud/contracts";
import { items } from "../service";
import ItemList from "./_components/ItemList.island";

export default async (c: { get: (key: string) => any; req: any }) => {
  const user = c.get("user");
  const url = new URL(c.req.url);
  const pagination = parsePagination({
    page: Number(url.searchParams.get("page") ?? 1),
  });

  const { items: data, total } = await items.list(pagination);
  const paginationResult = createPagination(pagination, total);

  return () => (
    <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "My App" }]}>
      <div class="max-w-4xl mx-auto">
        <h1 class="text-xl font-semibold mb-4">My Items</h1>
        <ItemList items={data} />
        <Pagination
          currentPage={paginationResult.page}
          totalPages={paginationResult.total_pages}
          baseUrl="/app/my-app?page="
        />
      </div>
    </Layout>
  );
};
```

**Key points:**
- Pages are async functions that receive the Hono context
- Fetch data server-side using services directly (no API calls needed on the server)
- Return a **render function** `() => JSX` (not JSX directly)
- Use `Layout` from `@valentinkolb/cloud/ssr` as the outermost wrapper
- `title` prop accepts breadcrumbs: `[{ title: "Parent", href: "/parent" }, { title: "Current" }]`

### Islands (Client Components)

Islands are interactive components that hydrate on the client:

```typescript
// frontend/_components/ItemList.island.tsx
import { createSignal, For } from "solid-js";
import { mutation } from "@valentinkolb/stdlib/solid";
import { prompts } from "@valentinkolb/cloud/ui";
import { apiClient } from "../../api/client";

export default function ItemList(props: { items: Item[] }) {
  const [items, setItems] = createSignal(props.items);

  const deleteItem = mutation.create({
    mutation: async (id: string) => {
      const res = await apiClient.items[":id"].$delete({ param: { id } });
      if (!res.ok) throw new Error((await res.json()).message);
    },
    onSuccess: (_, id) => {
      setItems((prev) => prev.filter((i) => i.id !== id));
    },
    onError: (err) => prompts.error(err.message),
  });

  const createItem = mutation.create({
    mutation: async () => {
      const result = await prompts.form({
        title: "New Item",
        icon: "ti ti-plus",
        fields: {
          title: { type: "text", label: "Title", required: true },
          description: { type: "text", label: "Description", multiline: true },
        },
      });
      if (!result) return null; // user cancelled

      const res = await apiClient.items.$post({ json: result });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (created) => {
      if (created) setItems((prev) => [created, ...prev]);
    },
    onError: (err) => prompts.error(err.message),
  });

  return (
    <div class="flex flex-col gap-2">
      <div class="flex justify-end">
        <button
          class="btn-primary btn-sm"
          disabled={createItem.loading()}
          onClick={() => createItem.mutate()}
        >
          {createItem.loading()
            ? <><i class="ti ti-loader-2 animate-spin" /> Creating...</>
            : <><i class="ti ti-plus" /> New Item</>}
        </button>
      </div>
      <For each={items()}>
        {(item) => (
          <div class="paper p-3 flex items-center justify-between">
            <span class="text-sm font-medium">{item.title}</span>
            <button
              class="btn-danger btn-sm"
              disabled={deleteItem.loading()}
              onClick={() => deleteItem.mutate(item.id)}
            >
              <i class="ti ti-trash" />
            </button>
          </div>
        )}
      </For>
    </div>
  );
}
```

**Key conventions:**
- File must end in `.island.tsx` — this is how the SSR framework detects islands (there is NO `"use client"` directive, that's Next.js)
- **ALL network calls must be inside `mutation.create()`** — never do manual fetch calls outside mutations
- `mutation` handles loading/error state automatically — never create manual loading/error signals
- `prompts.form()` goes INSIDE the mutation (it can also fail)
- Use `mutation.loading()` to show loading state and disable buttons
- Use the typed `apiClient` — never construct fetch calls manually
- Props are serialized from server → immutable initial data

### The Mutation + Prompts Pattern

This is the central UX pattern for all user actions. **Everything goes in the mutation** — including the prompt:

```typescript
import { mutation } from "@valentinkolb/stdlib/solid";
import { prompts } from "@valentinkolb/cloud/ui";

const saveThing = mutation.create({
  mutation: async () => {
    // 1. Collect input (inside the mutation — prompts.form can fail too)
    const data = await prompts.form({ title: "Save", fields: { ... } });
    if (!data) return null; // user cancelled

    // 2. Make the API call
    const res = await apiClient.things.$post({ json: data });
    if (!res.ok) throw new Error((await res.json()).message);
    return res.json();
  },
  onSuccess: (result) => { if (result) { /* update local state */ } },
  onError: (err) => prompts.error(err.message),
});

// 3. Wire to button with loading state
<button
  class="btn-primary btn-sm"
  disabled={saveThing.loading()}
  onClick={() => saveThing.mutate()}
>
  {saveThing.loading() ? "Saving..." : "Save"}
</button>
```

### Layout Patterns

The platform provides several layout conventions. Use `fullWidth` on `Layout` for multi-column layouts.

#### Table Layout (like Logging app)

```jsx
<Layout c={c} title="Admin" fullWidth>  {/* or use AdminLayout for admin pages */}
  <div class="flex flex-col gap-2">
    <div>
      <h1 class="text-base font-semibold text-primary">Items</h1>
      <p class="mt-1 text-xs text-dimmed">{total} entries</p>
    </div>
    <FilterBar filter={filter} />
    <ItemTable items={items} />
    <Pagination currentPage={p.page} totalPages={p.total_pages} baseUrl="/app/my-app?page=" />
  </div>
</Layout>
```

#### Sidebar + Content Layout (like Files, Weather)

```jsx
<Layout c={c} fullWidth title={breadcrumbs}>
  <div class="app-cols h-full">
    <MySidebar items={items} activeId={activeId} />
    <div class="flex-1 min-w-0 flex flex-col">
      <div class="flex-1 min-h-0 overflow-y-auto">
        {activeItem ? <Detail item={activeItem} /> : <EmptyState />}
      </div>
    </div>
  </div>
</Layout>
```

The `app-cols` class creates a responsive sidebar + content grid (sidebar hidden on mobile with toggle).

#### Card Grid Layout (like Spaces)

```jsx
<Layout c={c} title={breadcrumbs}>
  <div class="max-w-4xl mx-auto">
    <div class="p-6 mb-4 text-center">
      <h1 class="text-xl font-semibold mb-1">My Items</h1>
      <p class="text-sm text-dimmed">Description</p>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {items.map((item) => (
        <a href={`/app/my-app/${item.id}`}
           class="paper p-4 flex items-center gap-4 hover:paper-highlighted transition-all no-underline"
           style={`view-transition-name: card-${item.id}`}>
          <div class="w-10 h-10 rounded-xl bg-zinc-100 flex items-center justify-center">
            <i class="ti ti-star text-lg" />
          </div>
          <div class="flex-1 min-w-0">
            <span class="text-sm font-semibold text-primary block truncate">{item.title}</span>
            <p class="text-xs text-dimmed truncate">{item.description}</p>
          </div>
          <i class="ti ti-chevron-right text-dimmed" />
        </a>
      ))}
    </div>
  </div>
</Layout>
```

### UI Reference

> Full component props and CSS class reference → `references/frontend.md`

**Essential CSS classes:**

| Class | Purpose |
|-------|---------|
| `btn-primary`, `btn-secondary`, `btn-danger`, `btn-success`, `btn-simple` | Button variants |
| `btn-sm`, `btn-md` | Button sizes |
| `paper`, `paper-highlighted` | Card with border/shadow, hover state |
| `text-primary`, `text-secondary`, `text-dimmed`, `text-label` | Text colors |
| `app-cols` | Sidebar + content responsive grid |
| `info-block-info`, `info-block-warning`, `info-block-danger` | Banners |
| `section-label` | Small uppercase label for sections |

**Essential components from `@valentinkolb/cloud/ui`:**

| Component | Purpose |
|-----------|---------|
| `prompts.form({ fields })` | Form dialog with typed fields |
| `prompts.dialog(render, opts)` | Custom dialog |
| `prompts.error(message)` | Error dialog |
| `prompts.search(resolver, opts?)` | Search dialog with async results |
| `Pagination` | Page navigation with URL params |
| `FilterChip` | Multi-option filter dropdown |
| `EntitySearch` | User/group search autocomplete |
| `PermissionEditor` | Access control UI (grant/revoke via ResourceAccessAdapter) |
| `AppOverview` | Shared app overview/start-page shell |
| `AppWorkspace` | Shared sidebar + main + detail workspace shell |
| `DialogHeader` | Standard dialog header |
| `CopyButton` | Clipboard copy with feedback |

**All input components** are also from `@valentinkolb/cloud/ui` (not a sub-path):
`TextInput`, `NumberInput`, `Select`, `TagsInput`, `ImageInput`, `DateTimeInput`, `ColorInput`, `PinInput`, `Checkbox`, `Switch`, `SegmentedControl`, `Slider`

Note: Input components expect **accessor functions** for reactive props (e.g., `value={() => mySignal()}`, `error={() => errors().name}`).

Markdown editing (overtype-style overlay: toolbar with active-state, shortcuts, smart list continuation, URL-on-selection paste, optional `abbreviations` AutoText) has two entry points:
- `<TextInput markdown />` for form fields (wraps in standard `InputWrapper` chrome)
- `<MarkdownEditor />` for standalone editors like email composers or full-page notes (no chrome, raw surface)

Details in `references/frontend.md`.

### URL State Management

Filters and pagination live in URL params (SSR-friendly).

**In SSR pages** — read directly from the Hono request URL:

```typescript
const url = new URL(c.req.raw.url);
const search = url.searchParams.get("search") ?? "";
const page = Number(url.searchParams.get("page") ?? 1);
```

**In islands** — import the shared navigation helpers from `@valentinkolb/cloud/ui`:

```typescript
import { navigateTo, refreshCurrentPath, currentPathWithQuery } from "@valentinkolb/cloud/ui";

navigateTo("/app/my-app/123");   // hard navigation, adds history entry
refreshCurrentPath();             // window.location.assign(currentPath) — full SSR re-render
```

`refreshCurrentPath` is `window.location.assign(currentPathWithQuery())` — a full reload that re-runs SSR. It does not preserve scroll position or patch the DOM in place.

**For search/filter bars** — use `SearchBar` from `@valentinkolb/cloud/ssr/islands`:

```typescript
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";

// Automatically syncs search input to URL param and triggers navigation
<SearchBar action="/app/my-app" param="search" placeholder="Search items..." />
```

**For complex filters** — define typed filter builders per app:

```typescript
// frontend/lib/filter.ts
export const buildFilterUrl = (base: string, updates: Partial<Filter>, current: Filter) => {
  const url = new URL(base, window.location.origin);
  // only include non-default values to keep URLs clean
  if (updates.search ?? current.search) url.searchParams.set("search", updates.search ?? current.search);
  url.searchParams.delete("page"); // reset pagination on filter change
  return url.pathname + url.search;
};
```

### View Transitions

View transitions are enabled globally via `<meta name="view-transition" content="same-origin">` in the HTML template. **Always add `view-transition-name` to elements that should animate between pages.** This is not optional — use it on cards, headers, sidebars, tables, and any element that persists across page navigations.

```jsx
// Static names for page sections
<div style="view-transition-name: admin-logs-title">...</div>
<section style="view-transition-name: admin-logs-table">...</section>

// Dynamic names for list items (enables card ↔ detail transitions)
<a href={`/app/my-app/${item.id}`} style={`view-transition-name: item-card-${item.id}`}>...</a>
```

**Naming convention:** `{app}-{element}-{id?}`. For sidebars with many items, use a `vt()` helper:

```typescript
const vt = (key: string) => `contacts-sidebar-${key}`;
<div style={`view-transition-name:${vt(`book-${book.id}`)}`}>...</div>
```

### Settings Integration

Declare per-app settings inside `defineApp({ settings: { ... } })` as a typed map of dotted-key → definition. Reads happen either through the typed snapshot on `c.get("settings")` (sync, frozen for the request) or through the global getter from `@valentinkolb/cloud/services/settings`:

```typescript
// config.ts — the single source of truth for app settings
import { defineApp } from "@valentinkolb/cloud";

export const app = defineApp({
  id: "my-app",
  // ...
  settings: {
    "my-app.feature_enabled": {
      kind: "boolean",
      label: "Enable feature X",
      default: true,
      description: "Whether feature X is active.",
    },
  },
});

// In a service or any non-request context:
import * as settings from "@valentinkolb/cloud/services/settings";

const enabled = await settings.get<boolean>("my-app.feature_enabled");
```

All `settings.*` reads are async — they go through the Redis cache-aside layer (5-minute TTL). Inside an HTTP handler prefer the sync per-request snapshot on `c.get("settings")` populated by `middleware.settings()`. Settings automatically appear in the admin settings UI, grouped by the dotted-key prefix.

### Universal Search Integration

Add search to your app via `capabilities` in `app.start()`. See `packages/weather/src/capabilities.ts` for a real example:

```typescript
capabilities: {
  search: {
    tags: ["items"],
    help: "Search items by title",
    run: async ({ query, limit, ctx }) => {
      const rows = await sql`
        SELECT id, title FROM my_app.items
        WHERE LOWER(title) LIKE ${'%' + query.toLowerCase() + '%'}
        LIMIT ${limit}
      `;
      return rows.map((r) => ({
        id: r.id as string,
        title: r.title as string,
        href: `/app/my-app/${r.id}`,
        icon: "ti ti-star",
      }));
    },
  },
},
```

### WebSockets

Hono v4+ supports WebSockets natively via Bun. Import the WebSocket adapter from `hono/bun`, register WS routes on your composed router, and spread the `app.start()` result with the websocket handler so Bun picks it up:

```typescript
// In index.ts
import { websocket } from "hono/bun";

const result = await app.start({ fetch: router.fetch, openapi: apiRoutes });
export default { ...result, websocket };
```

See the `notebooks` app for a complete WebSocket implementation.

## New App Checklist

1. Create directory: `packages/my-app/` with `package.json`, `tsconfig.json`, `tsconfig.typecheck.json`.
2. Create skeleton source files under `packages/my-app/src/`: `config.ts`, `index.ts`, `api/index.ts`, `api/client.ts`, `contracts.ts`, `migrate.ts`, `service/index.ts`, `styles/app.css`, `frontend/index.ts`, `frontend/page.tsx`.
3. Add a service block in `compose.dev.yml` (see `cloud-ops` skill).
4. Add a `COPY packages/my-app/package.json packages/my-app/` line in `Dockerfile.dev` so the install layer caches the new workspace.
5. `bun install` to refresh the lockfile, then `bun run dev:start my-app` (or `bun run dev:full` for everything). Migrations run on first startup; the gateway picks up the new app from Redis within ~5 s. Use `bun run dev:help` to see the full set of dev commands.

The standalone reference implementation lives at [github.com/ValentinKolb/cloud-template](https://github.com/ValentinKolb/cloud-template) — clone it as a starting point. Inside the monorepo, `packages/weather` (simple) or `packages/contacts` (permissions/detail panels) are the closest analogues.
