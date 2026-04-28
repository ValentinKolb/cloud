<h1 align="center">Building apps on Cloud</h1>

<p align="center">
  <em>From <code>git clone</code> to a running app with admin page, widget, email, and logging.</em>
</p>

Reference implementation: [`packages/expeditions/`](./packages/expeditions) — a compact app showcasing platform primitives (tenancy, permissions, admin, widget, email, logging).

---

## Prerequisites

| Tool | Why | Install |
|---|---|---|
| **Bun** ≥ 1.3 | Runtime and bundler. | `curl -fsSL https://bun.sh/install \| bash` |
| **Docker** + **Docker Compose** | Each app runs as one container. | [docker.com/get-started](https://www.docker.com/get-started) |
| **Git** | Source control. | system package manager |

PostgreSQL and Valkey come up via `docker compose`.

```bash
git clone https://github.com/ValentinKolb/cloud
cd cloud
bun install               # workspace deps
bun run infra             # postgres, valkey, geo, filegate
bun run dev               # 7-container core set
open http://localhost:3000
```

Dev admin login: open `/auth/login?method=admin` and paste `dev-admin` into the token field (the `ADMIN_LOGIN_TOKEN` baked into `app-core`). Full dev command list in [README.md](./README.md).

---

## The mental model

An app is a Bun process behind Hono, packaged as a Docker container. Every app receives:

- session, login, roles, CSRF, rate limiting
- the UI kit (`@valentinkolb/cloud/ui`) and SSR layout primitives (`Layout`, `AdminLayout`)
- service registration in Redis — the gateway routes to a new container within ~5 s of boot
- a dedicated Postgres schema (`expeditions.*`, `notebooks.*`, …)
- platform services for logging, settings, transactional email, universal search

Apps own their domain tables and business logic. Authentication, role definitions, and the `auth.*` schema belong to `packages/cloud/`; see [skills/cloud/SKILL.md § Core-Owned Domains](./skills/cloud/SKILL.md).

```
                          HTTPS
                            ▼
                    ┌───────────────┐
                    │    Gateway    │   reads Redis registry, prefix-routes
                    └───┬───┬───┬───┘
                        ▼   ▼   ▼
                 ┌─────────┐ ┌─────────┐ ┌─────────┐
                 │ app-A   │ │ app-B   │ │ app-C   │   one container = one app
                 └────┬────┘ └────┬────┘ └────┬────┘
                      └──────────┴────────────┘
                                 │
                       ┌─────────┴─────────┐
                       ▼                   ▼
                  ┌─────────┐         ┌──────────┐
                  │  Redis  │         │ Postgres │
                  └─────────┘         └──────────┘
```

---

## Anatomy of an app

`expeditions` exercises every primitive in one app: a tenancy entity, child items, permissions, admin page, widget, email, structured logging.

```
packages/expeditions/
├── package.json                 workspace manifest
├── tsconfig.json                path aliases for @/* and @valentinkolb/cloud/*
├── tsconfig.typecheck.json      called by `bun run typecheck`
└── src/
    ├── config.ts                defineApp({...}) — id, nav, widgets, baseUrl
    ├── index.ts                 app.start({...}) — wires routes + lifecycle
    ├── migrate.ts               idempotent CREATE SCHEMA / TABLE IF NOT EXISTS
    ├── contracts.ts             Zod schemas → inferred TS types
    ├── styles/app.css           per-app Tailwind entrypoint
    ├── service/
    │   ├── index.ts             facade — expeditionsService.expedition.*, .waypoint.*, .access.*
    │   ├── expeditions.ts       tenancy CRUD + admin queries
    │   ├── waypoints.ts         child CRUD + completion email side-effect
    │   └── access.ts            junction → auth.access via cloud-lib helpers
    ├── api/
    │   ├── index.ts             Hono router, auth.requireRole + describeRoute
    │   ├── widgets.ts           dashboard widget endpoint
    │   └── client.ts            api.create<ApiType>(...) — typed RPC for islands
    └── frontend/
        ├── index.ts             route assembly (default + adminPages exports)
        ├── page.tsx             SSR list page
        ├── [id]/page.tsx        SSR detail page (gated by permission level)
        ├── admin.tsx            SSR admin page (sysadmin-only)
        └── *.island.tsx         interactive islands (one file per action)
```

### File responsibilities

**`config.ts`** — app identity. `id` ends up in URLs and the Redis registry; `baseUrl` matches the container name in `compose.dev.yml`. Widget endpoints declared here are picked up by the dashboard at registration time.

**`index.ts`** — bootstrap. `app.start({ routes, lifecycle, capabilities })` starts Hono on port 3000, mounts route bundles at the platform-expected paths, runs `lifecycle.setup` once on boot, registers in Redis with a heartbeat, and shuts down on `SIGTERM`. Standard mount points:

| Path | Purpose |
|---|---|
| `/api/<id>/widgets/*` | dashboard widget endpoints |
| `/api/app/<id>/*` | app's CRUD API (called by islands via `apiClient`) |
| `/app/<id>/*` | SSR pages |
| `/admin/<id>/*` | admin SSR pages, gated by `auth.requireRole("admin", …)` |

**`migrate.ts`** — runs on every container startup. `CREATE … IF NOT EXISTS` and `.simple()` keep migrations idempotent. Postgres counts dropped columns toward the 1600-column hard limit, so design columns to stick around. The schema is namespaced (`expeditions.*`).

**`contracts.ts`** — Zod schemas serve as runtime validators and as the source for inferred TypeScript types. The same schemas feed `describeRoute`, keeping the OpenAPI doc at `/api/_openapi` aligned with the implementation.

**`service/`** — stateless namespaced functions, shape `serviceName.entity.action(config)`. Both API routes and SSR pages call services directly. Permission checks live inside the service so SSR access stays gated regardless of the calling layer.

**`api/`** — thin handlers. Each handler validates input via `v("json", Schema)`, calls a service, and returns the result through `respond(c, …)`. Service results are `Result<T>` from `@valentinkolb/stdlib`; `respond` maps `ok` to 200 and `fail` to the appropriate 4xx/5xx with a JSON body.

**`api/client.ts`** — `api.create<ApiType>({ baseUrl })` produces a typed RPC client. Renames or signature changes in handlers surface as compile errors in islands.

**`frontend/`** — SSR pages return `() => JSX`. The platform's `ssr<AuthContext>(handler)` wrapper handles cookie loading, settings snapshotting, and serialization. Pages render inside `<Layout>` (or `<AdminLayout>`).

**Islands (`*.island.tsx`)** — interactive components, hydrated on the client. The filename suffix triggers bundling. Network calls go through `mutation.create({ … })` from `@valentinkolb/stdlib/solid`, which provides a reactive `loading()` signal and structured success/error callbacks.

---

## The mutation + prompts pattern

The standard recipe for a user action: collect input via `prompts.*`, run the API call inside `mutation.create`, react via `onSuccess` / `onError`.

```tsx
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { prompts, refreshCurrentPath } from "@valentinkolb/cloud/ui";
import { apiClient } from "@/api/client";

const createWaypoint = mutations.create<void, { title: string }>({
  mutation: async (data) => {
    const res = await apiClient[":id"].waypoints.$post({
      param: { id: expeditionId },
      json: data,
    });
    if (!res.ok) {
      const body = await res.json();
      throw new Error("message" in body ? body.message : "Failed");
    }
  },
  onSuccess: () => refreshCurrentPath(),
  onError: (e) => prompts.error(e.message),
});

const handleClick = async () => {
  const result = await prompts.form({
    title: "Add waypoint",
    icon: "ti ti-map-pin-plus",
    fields: { title: { type: "text", label: "Title", required: true } },
  });
  if (result) createWaypoint.mutate(result);
};
```

`prompts.form` opens a typed dialog and resolves with the field values, or `null` on cancel. `refreshCurrentPath()` triggers a full SSR re-render of the current path via `window.location.assign(currentPathWithQuery())` — the server stays the source of truth.

Prompt variants:

| Variant | Use for |
|---|---|
| `prompts.confirm(message, opts)` | destructive yes/no, returns boolean |
| `prompts.form({ fields })` | typed input dialog with built-in validation |
| `prompts.dialog((close) => <JSX/>, opts)` | custom dialog body — used for `<PermissionEditor>` etc. |
| `prompts.error(message)` | toast-style error |
| `prompts.alert(message, opts)` | informational, single OK button |
| `prompts.search(resolver, opts?)` | async-loaded picker |

---

## Why the MPA feels like an SPA: view transitions

Every app is a separate Bun process behind the gateway, and every navigation is a real cross-container HTTP request — yet the UI feels SPA-smooth. Two pieces of platform glue make that work:

```html
<meta name="view-transition" content="same-origin">    <!-- HTML head, set by the platform -->
```

```css
@view-transition { navigation: auto; }                 /* global.css, applied to every app */
```

Together these opt every same-origin navigation into the browser's native View Transitions API: the outgoing page is captured as a snapshot, the incoming page renders, and the browser cross-fades between them automatically. No client-side router, no hydration, no SPA shell. The user sees a seamless transition; under the hood it's still `window.location.assign(...)`.

**Shared-element morphs** are opt-in via `view-transition-name`. Anything that persists across pages — a card on a list page that becomes a header on its detail page, a sidebar item that morphs into the active page title, the global navigation rail — should carry a stable name on both sides:

```jsx
// list page — each card carries a unique name
<a href={`/app/expeditions/${e.id}`}
   style={`view-transition-name: expedition-card-${e.id}`}>
  {e.title}
</a>

// detail page — the header shares the name of the card the user clicked
<h1 style={`view-transition-name: expedition-card-${expedition.id}`}>
  {expedition.title}
</h1>
```

The browser interpolates position, size, and opacity between the two named elements during the transition. Convention: `{app}-{element}-{id?}` so names stay unique across containers. Use it on cards ↔ detail headers, sidebar entries ↔ page titles, table rows ↔ detail panels, and any other element a user "follows" between routes.

Because the gateway aggregates all containers under one origin, a navigation from `/app/spaces/123` to `/app/notebooks/456` is *also* a same-origin request — the browser cross-fades between two different Bun processes without anyone noticing.

---

## Platform primitives

### Authentication

```ts
import { auth, type AuthContext } from "@valentinkolb/cloud/server";

new Hono<AuthContext>()
  .use(auth.requireRole("user"))                  // signed-in non-guest
  .use(auth.requireRole("admin"))                 // sysadmin only
  .use(auth.requireRole("authenticated"))         // any signed-in user incl. guests
  .use(auth.requireRole("*"))                     // load user if present
  .use(auth.requireRole("anonymous"))             // logged-out users only
```

After the middleware runs, `c.get("user")` returns the full `User` (id, displayName, mail, memberofGroupIds, roles…). On SSR pages, pass `auth.redirectToLogin` as the second argument to redirect anonymous visitors to `/auth/login?redirectTo=…`.

### Logging

```ts
import { logger } from "@valentinkolb/cloud/services/logging";

const log = logger("expeditions");
log.info("waypoint.created", { expeditionId, waypointId });
log.error("expedition.completion-mail.failed", { expeditionId, message: e.message });
```

Writes to `logging.entries` happen asynchronously and stay non-blocking. The admin viewer at `/admin/logging` aggregates entries across every app, filterable by source. Sensitive keys (`password`, `token`, `secret`, `cookie`, `authorization`, `api_key`, `session`) are auto-redacted before persistence.

### Transactional email

`notifications.send` is the public API. It persists the message to `notifications.messages`, attempts SMTP delivery via the platform's transporter, records `sent_at` / `error`, and surfaces the result in the admin viewer at `/admin/notifications` — one call covers send + audit + retry surface.

```ts
import { notifications } from "@valentinkolb/cloud/services";

await notifications.send({
  type: "email",
  recipient: "user@example.com",
  subject: "🏁 Expedition completed: Apollo 11",
  content: "Hi Alice,\n\nYou just completed the expedition…",
  // rawHtml: "<h1>…</h1>",   // alternative to plain `content`
  // autoSend: false,          // queue for manual review (admin viewer)
  // sentBy: user.id,          // attribute to a user in the audit log
});
```

`sendEmail` exists as the underlying SMTP primitive in `@valentinkolb/cloud/services/notifications/email` but is not exported from the public services barrel. Reach for it only when you genuinely want fire-and-forget without DB persistence.

Mail delivery should stay out of the request path: wrap the call in `.catch((e) => log.error("...", { message: e.message }))` so a transient SMTP failure leaves the user's mutation successful.

### Settings

Runtime-configurable, encrypted at rest, cached in memory. Resolution order: DB value → env fallback → code default.

App-owned settings are declared inside `defineApp({ settings: { ... } })` as a typed map of dotted-key → definition. The platform registers them automatically on import, and the keys become typed on `c.get("settings")` in any route using `Hono<AppContext<typeof app>>`.

```ts
// config.ts
import { defineApp } from "@valentinkolb/cloud";

export const app = defineApp({
  id: "expeditions",
  // …
  settings: {
    "expeditions.notify_on_completion": {
      kind: "boolean",
      label: "Notify on completion",
      default: true,
      description: "Email the creator when an expedition completes.",
    },
  },
});
```

```ts
// In a service or any non-request context — sync read from the in-memory cache:
import { getSync } from "@valentinkolb/cloud/services";

const enabled = getSync<boolean>("expeditions.notify_on_completion");
```

Inside HTTP handlers using `Hono<AppContext<typeof app>>`, prefer the typed per-request snapshot: `c.get("settings")["expeditions.notify_on_completion"]` is sync, frozen for the request, and fully type-checked.

Registered settings appear in `/admin/settings`, grouped by the dotted-key prefix.

### Dashboard widgets

A widget endpoint returns a `WidgetResponse` body. The dashboard discovers it via the `widgets[]` array in `defineApp(…)` and forwards the user's session.

```ts
// api/widgets.ts
const app = new Hono<AuthContext>()
  .use(auth.requireRole("*"))
  .get("/active", async (c) => {
    const user = c.get("user");
    if (!user) return c.body(null, 403);   // 403 = "locked at your access level"

    const result = await expeditionsService.expedition.list({ userId: user.id, groups: user.memberofGroupIds });
    const body: WidgetResponse = {
      title: "Expeditions",
      icon: "ti ti-map-2",
      href: "/app/expeditions",
      blocks: [{ kind: "list", grow: true, items: result.items.slice(0, 6).map(/* … */) }],
    };
    return c.json(body);
  });
```

Block kinds: `stat`, `list`, `status`, `pills`, `hero`. `stat`, `list`, `status`, and `pills` accept `grow: true` to fill remaining vertical space; `hero` always grows to fill its container (widgets render at a fixed `25rem` height). 200 renders the widget; 403 places it under "locked at your access level". Type definitions in `packages/cloud/src/contracts/widgets.ts`; grid composition in `packages/dashboard/`.

### Universal search

A `capabilities.search` block in `app.start()` makes results available under `Cmd+K`:

```ts
capabilities: {
  search: {
    tags: ["expeditions"],
    help: "Search expeditions by title",
    run: async ({ query, limit, ctx }) => {
      const rows = await sql`
        SELECT id, title FROM expeditions.expeditions
        WHERE LOWER(title) LIKE ${"%" + query.toLowerCase() + "%"}
        LIMIT ${limit}
      `;
      return rows.map((r) => ({ id: r.id, title: r.title, href: `/app/expeditions/${r.id}`, icon: "ti ti-map-2" }));
    },
  },
},
```

Reference: `packages/weather/src/capabilities.ts`.

### WebSockets

Hono v4 + Bun has native WS support. Mount handlers on the API router and re-export the websocket adapter from `index.ts`:

```ts
import { websocket } from "hono/bun";
const result = await app.start({ routes, lifecycle });
export default { ...result, websocket };
```

Reference: `packages/notebooks/` (Yjs document sync).

---

## Layout patterns

Every page renders inside `Layout` or `AdminLayout`. `title` accepts a string or breadcrumb array. `fullWidth` drops the centered column for multi-column layouts.

| Pattern | Use for | Reference app |
|---|---|---|
| **Card grid** — `max-w-4xl mx-auto` + `grid grid-cols-1 sm:grid-cols-2 gap-2` of `<a class="paper">` | List of "things you own" with quick visual scan | `expeditions/src/frontend/page.tsx`, `notebooks` |
| **Sidebar + content** — `<Layout fullWidth>` with `app-cols` grid, sidebar in `order-1 lg:order-1`, main in `order-3 lg:order-2`, optional detail panel `order-2 lg:order-3` | Tree navigation + main view + side detail | `notebooks/src/frontend/[id]/page.tsx`, `files`, `contacts` |
| **Admin table** — `<AdminLayout stretch>` with `StatCell` summary cards on top, `SearchBar`, then `<table class="w-full text-xs">` | List + search + pagination over a single resource | `expeditions/src/frontend/admin.tsx`, `logging`, `notebooks/admin.tsx` |
| **Detail with action header** — single-column `paper` with header + ordered list of `paper`-rowed items | One thing in depth, with inline action buttons | `expeditions/src/frontend/[id]/page.tsx`, `spaces` |

### CSS classes

| Class | Purpose |
|---|---|
| `paper`, `paper-highlighted` | rounded card, optional hover variant |
| `btn-primary`, `btn-secondary`, `btn-danger`, `btn-success`, `btn-simple`, `btn-input` | button variants |
| `btn-sm`, `btn-md` | button sizes |
| `text-primary`, `text-secondary`, `text-dimmed`, `text-label` | foreground tones |
| `app-cols` | responsive sidebar + content grid |
| `info-block-info`, `info-block-warning`, `info-block-danger` | inline banners |
| `section-label` | small uppercase section header |
| `thumbnail` | rounded square icon container |
| `divider` | horizontal separator |

Per-app `styles/app.css` contains `@import "tailwindcss";` plus an `@source` glob; `global.css` builds once in the `core` app.

### Icons

Tabler Icons referenced as classes: `<i class="ti ti-map-2 text-dimmed" />`. Browse at [tabler.io/icons](https://tabler.io/icons).

### View transitions

See [Why the MPA feels like an SPA: view transitions](#why-the-mpa-feels-like-an-spa-view-transitions) above. Auto-crossfade is on by default; add `style="view-transition-name: …"` to any element that should morph across routes.

---

## URL state

Pagination, filters, and current selection live in the URL.

SSR pages read directly from the request:

```ts
const url = new URL(c.req.raw.url);
const search = url.searchParams.get("search") ?? "";
const page = Number(url.searchParams.get("page") ?? 1);
```

`SearchBar` from `@valentinkolb/cloud/ssr/islands` syncs an input field to a URL param:

```tsx
<SearchBar action="/admin/expeditions" param="search" placeholder="Search…" />
```

Islands update the URL via the navigation helpers:

```ts
import { navigateTo, refreshCurrentPath } from "@valentinkolb/cloud/ui";

navigateTo("/app/expeditions");           // hard navigation
refreshCurrentPath();                     // re-run SSR for the current URL
```

After a create / update / delete on the same page, `refreshCurrentPath` triggers a full SSR re-render via `window.location.assign`.

---

## Adding the container

Three places need to know about a new app.

**1. `Dockerfile.dev`** — add a `COPY` line for the new package's `package.json`:

```dockerfile
COPY packages/expeditions/package.json packages/expeditions/
```

**2. `compose.dev.yml`** — add a service block under `services:`. Apps under `profiles: [extra]` start only with `bun run dev:full` or `bun run dev:app <name>`.

```yaml
app-expeditions:
  <<: *app
  container_name: app-expeditions
  environment: { <<: *env, APP_ID: expeditions }
  profiles: [extra]
  volumes:
    - ./packages/cloud/src:/app/packages/cloud/src
    - ./packages/expeditions/src:/app/packages/expeditions/src
    - ./styles.css:/app/styles.css
  command: bun run --preload=/app/packages/cloud/scripts/preload.ts --watch packages/expeditions/src/index.ts
```

**3. The workspace** — Bun's workspace globbing already covers `packages/*`. Re-run `bun install` to refresh the lockfile.

---

## Verifying

```bash
cd packages/expeditions
bun run typecheck

cd ../..
bun run dev:app expeditions               # join the running stack
docker logs -f app-expeditions

# smoke tests
curl -sI http://localhost:3000/app/expeditions               | head -1   # 302 → login
curl -sI http://localhost:3000/api/app/expeditions/          | head -1   # 401
curl -sI http://localhost:3000/public/expeditions/app.css    | head -1   # 200
```

The gateway picks up the container ~5 s after registration. `docker logs gateway` confirms with `Route table rebuilt: N routes from M apps`.

---

## Pattern → reference

| For… | See |
|---|---|
| Tenancy + child items + permissions + email | [`packages/expeditions/`](./packages/expeditions) |
| Tree-style sidebar with hierarchical items | [`packages/notebooks/src/frontend/[id]/_components/sidebar/`](./packages/notebooks) |
| Drag-and-drop kanban with columns + tags | [`packages/spaces/src/frontend/[id]/`](./packages/spaces) |
| Master/detail with sidebar + list + detail panel | [`packages/contacts/src/frontend/`](./packages/contacts) |
| External HTTP API with caching | [`packages/weather/src/service/`](./packages/weather) |
| API-only app with a widget | [`packages/quotes/`](./packages/quotes) |
| Yjs collaborative document over WebSocket | [`packages/notebooks/`](./packages/notebooks) |
| Filterable + paginated admin table | [`packages/logging/src/frontend/`](./packages/logging) |
| Encrypted settings + dynamic admin form | [`packages/settings/`](./packages/settings) |
| File proxying via Filegate token | [`packages/files/`](./packages/files) |
| Component showcase / live UI playground | [`packages/ui-lab/`](./packages/ui-lab) |
| Sysadmin UI on top of a core service | [`packages/accounts/`](./packages/accounts) |
| OAuth2 issuer | [`packages/oauth/`](./packages/oauth) |
| Traefik forward-auth bridge | [`packages/proxy-auth/`](./packages/proxy-auth) |

---

## Reference

- [`README.md`](./README.md) — platform overview
- [`packages/expeditions/`](./packages/expeditions) — reference implementation
- [`skills/cloud/SKILL.md`](./skills/cloud/SKILL.md) — architecture, auth model, services
- [`skills/cloud-app/SKILL.md`](./skills/cloud-app/SKILL.md) — app-building reference
- [`skills/cloud-app/references/backend.md`](./skills/cloud-app/references/backend.md) — backend patterns
- [`skills/cloud-app/references/frontend.md`](./skills/cloud-app/references/frontend.md) — frontend patterns
- [`skills/cloud-ops/SKILL.md`](./skills/cloud-ops/SKILL.md) — ops, deployment, env vars
