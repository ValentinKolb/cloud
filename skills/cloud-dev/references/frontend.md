# Frontend: pages, shells, and islands

How Cloud UI is built. For the exact props of a component, go to `components.md`. For visual and interaction rules, `design.md` — read that **before** styling anything new.

## SSR architecture

Cloud uses `@valentinkolb/ssr`, a minimal SolidJS islands framework for Bun.

- **Pages** (`.tsx` under `frontend/`) run on the server, fetch data, and return JSX.
- **Islands** (`.island.tsx`) hydrate on the client with full SolidJS reactivity.
- **Server components** (plain `.tsx` imported by a page) render once on the server and are never shipped to the client.

Data flows one way: the page fetches, passes props into JSX, and islands receive serialized props and hydrate independently.

### SSR-first, and what that actually forbids

Cloud is SSR-first: the server renders the answer, and the browser enhances it. Every screen must be correct on a cold load with no JavaScript run yet, because that is the path that reload, sharing, back/forward, and search all take. Enhanced navigation is an optimisation layered on top — never the only correct route.

The consequence is a hard rule:

> **Never filter, sort, paginate, group, or aggregate a result set in the browser.**

The client owns **intent**; the server owns the **result set**. Doing it client-side is wrong four ways at once:

- **Correctness.** The browser holds only the rows it was already given. Filtering page 1 of 200 silently returns "no matches" for a record that exists.
- **Permissions.** Access conditions are resolved in SQL against the request's `accessSubject`. A client filter cannot apply them — and a client that received rows it should filter *out* has already been over-served.
- **Consistency.** Reloading or sharing the URL must reproduce exactly what the user saw. That only holds if the URL drives a server query.
- **Cost.** Shipping a dataset in order to narrow it in the browser scales with the table, not with the answer.

The correct shape is always the same loop:

```
user intent  →  URL params  →  SSR page or typed route-state endpoint  →  SQL WHERE / ORDER BY / LIMIT  →  rendered result
```

So a filter chip does not remove rows from a signal — it commits a URL change. A search box does not scan an array — it debounces a commit that re-queries. A "group by status" control does not `reduce()` — it changes a query parameter. Totals and counts come from `COUNT(*)` in the same query, not from `items().length`, which only ever counts the current page.

**The narrow exceptions**, both of which are about intent rather than results: a genuinely bounded, fully-loaded set that is already entirely in memory — the options of a picker, the tabs of a settings dialog — may be filtered locally; and purely presentational client state such as an open/closed panel or a hovered row never belongs in a query.

Aggregation follows the same rule and is stricter: stats, rollups, and chart series are computed in SQL — see the aggregation and CTE patterns in `backend.md` — never by summing a page of rows in an island.

### Pages

A page exports a pre-wrapped `ssr<AuthContext>(...)` handler and returns a **render function**, not JSX:

```tsx
// frontend/page.tsx
import { ssr } from "../config";
import { hasPermission, type AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { myService } from "../service";

export default ssr<AuthContext>(async (c) => {
  const accessSubject = c.get("accessSubject");
  const url = new URL(c.req.raw.url);

  const permission = await myService.items.permissionFor(accessSubject);
  if (!hasPermission(permission, "read")) return c.redirect("/app/my-app");

  const data = await myService.items.list({ accessSubject, search: url.searchParams.get("search") });

  return () => (
    <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "Items" }]}>
      <ItemList items={data} />
    </Layout>
  );
});
```

> **SSR pages call services directly, so no route middleware has run on that call.** Repeat the permission check here. This is the single most common security bug in Cloud apps: the API route is protected, the page that renders the same data is not.

Note what the page passes down: **`accessSubject`, not a user id.** Route middleware gates *who may reach the page*; the service still decides *what they may see*, and only the subject expresses that for a user, a user-bound key, and a resource-bound principal alike.

`c.get("user")` is the legacy, pre-service-account path. It is safe **only** on a page explicitly gated to a user-backed role *and* serving a genuinely personal surface — `/me`, profile, personal catalogs. Everywhere else it will silently break for API keys and OAuth service tokens. The variable is typed `User` but is `undefined` for a resource-bound principal, so the compiler will not catch the mistake. See `auth.md`.

### Routing

Routes are **not** derived from the directory tree. Map them explicitly; the directory layout is organisation only.

```typescript
// frontend/index.ts
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

Auth middleware is applied per route. `ssr()` produces a middleware array, which is why the pages are spread.

Register `/help` and `/help/:topic` **before** any dynamic or catch-all route — see `help.md`.

### Public pages

> **`/public/<app>` is not where public pages go.** It is framework-owned static asset delivery, mounted before your fetch and terminal — a page registered there is simply never reached.

Anonymous-facing HTML gets its own prefix, declared in `routes` like any other. `/share/my-app` is the established choice:

```typescript
// config.ts
routes: ["/api/my-app", "/app/my-app", "/admin/my-app", "/public/my-app", "/share/my-app"],
```

```typescript
// frontend/index.ts — a page serving both anonymous and signed-in visitors
.get("/:token", auth.requireRole("*"), ...publicPage)
```

`auth.requireRole("*")` loads the user if one is present and does not require it. **That is not the access check** — the page still validates the token or resource grant server-side, in the service layer, exactly as an authenticated route would. A public page is a different audience, not a different security model.

Public pages may carry domain-specific visual style, but they use Cloud primitives for behaviour: the typed client for JSON calls, `target="_blank" rel="noreferrer"` on links that leave the page, and precise wording about what is anonymous and what is not.

### Layout

`Layout` is the outermost wrapper on every page. It supplies the entire platform chrome: header and breadcrumbs, navigation rail, mobile menu, global search, theme toggle, and footer.

```tsx
<Layout
  c={c}
  title={[{ title: "Start", href: "/" }, { title: "My App", href: "/app/my-app" }, { title: "Detail" }]}
  fullWidth   // remove content side padding — for multi-column layouts
  fullPage    // remove footer, hide overflow — for fill-height layouts
>
```

The last breadcrumb has no `href`. A plain string works too.

Navigation is built from the live app registry — `Layout` reads `runtime.apps` and filters by section and role. You never hardcode navigation: registering a container with a `nav` config is enough for it to appear everywhere. To open the platform app picker from an island, call `openAppLaunchpad()` from `@valentinkolb/cloud/ssr/islands` rather than building a picker.

`AdminLayout` wraps `Layout` with the admin sidebar, built from the same registry. Its `title` prop feeds **breadcrumbs only** — every admin page renders its own `<h1>` as the first child:

```tsx
<AdminLayout c={c} title="Logs">
  <div class="flex flex-col gap-2">
    <div class="min-w-0" style="view-transition-name: admin-logs-title">
      <h1 class="text-base font-semibold text-primary">Logs</h1>
    </div>
    {/* stats, search, table */}
  </div>
</AdminLayout>
```

Keep the title a plain block, not a flex row shared with a button — pairing it with a taller control vertically centres the heading and visibly drops it. Action buttons belong in their own row below the stats or search bar. Use `text-base font-semibold text-primary` and a `view-transition-name: admin-<slug>-title`.

## Choosing a shell

Pick the shared primitive that matches the surface, then put domain content inside it. Do not design a new overview, workspace, settings flow, or table layout unless the user explicitly asked for a new platform pattern.

| Surface | Primitive |
|---|---|
| App start page with resource cards and create actions | `AppOverview` with `Main` and `Aside title="Create"` |
| Full resource workspace (sidebar + main + optional detail) | `Layout fullWidth` + `AppWorkspace` |
| IDE-like query/editor workspace | `Panes` inside `AppWorkspace.Main` |
| Stable list/reader or navigator/canvas split | `AppWorkspace.MainPane` |
| List with contextual detail | `AppWorkspace.Detail` after Main, selection in the URL |
| Secondary activity, log, preview, composer | `AppWorkspace.BottomDrawer` |
| Resource settings | `SettingsModal`, opened in a bare `prompts.dialog` |
| Complex editor modal | `PanelDialog` |
| Small form | `prompts.form` |
| Calendar | `Calendar` with view and date in URL route state |
| Tabular data or log lists | `DataTable` |
| Dashboard metrics | `StatGrid` + `StatCell` |

`DockWorkspace` is deprecated. It remains exported for backwards compatibility; use `Panes` for anything new.

If nothing fits, look at `/app/ui-lab` and the component source under `packages/cloud/src/ui/` before writing local layout code.

**Do not restyle a shared shell locally.** If the design system genuinely cannot express a requirement, improve the primitive and record the rule in `design.md` — do not add an app-specific exception.

### Anti-patterns

- A bespoke overview or settings layout where `AppOverview` / `SettingsModal` fits.
- A second grid or flex column inside `AppWorkspace.Main` imitating a detail panel.
- A local resize handle, cookie, or CSS variable reimplementing workspace geometry.
- Raw `fetch("/api/...")` in an island for an app JSON API.
- A hand-written `<table>` or stat grid where `DataTable` / `StatGrid` matches.
- A calendar-shaped domain rendered as a static list.
- A feature type that can be created but not edited, deleted, or rendered afterwards.
- Contextless stats — a bare `4` with no label, range, or denominator.

## Islands

```tsx
// _components/ItemList.island.tsx
import { createSignal, For } from "solid-js";

export default function ItemList(props: { items: Item[] }) {
  const [items, setItems] = createSignal(props.items);
  return <For each={items()}>{(item) => <div>{item.title}</div>}</For>;
}
```

Rules:

- The filename must end in `.island.tsx`. That is how the framework detects an island — there is no `"use client"` directive, that is a Next.js concept.
- **An island must not import another `.island.tsx` or `.client.tsx`.** Nested hydration boundaries are unsupported. Child components inside one owning island are plain `.tsx`, even when they hold signals, effects, or mutations.
- Props must be serializable — no functions, no class instances.
- Islands hydrate independently and share no state. To couple two mounted islands, use URL state or a typed window event.
- Use SolidJS primitives: `createSignal`, `createMemo`, `createEffect`, `For`, `Show`, `Switch`/`Match`.

## The mutation + prompts pattern

The central pattern for **user-initiated writes**: create, update, delete, archive, upload, anything the user triggers that changes server state. **Everything goes inside the mutation** — including the prompt that collects input, because the prompt can fail or be cancelled too.

Where the boundary runs: `mutation.create()` owns a call whenever the UI needs loading, error, retry, or stale-result handling tied to a user action. It is **not** required for machinery that owns an equivalent lifecycle itself — the read-only route-state loader in `onNavigate` below, which has `nav.fallback()` as its error path, or a live WebSocket stream, which has reconnect and resume. Those call the typed client directly and that is correct.

What never changes: no hand-rolled loading/error signals, and no raw `fetch()` for an app JSON API.

```typescript
import { mutation } from "@valentinkolb/stdlib/solid";
import { prompts, toast } from "@valentinkolb/cloud/ui";
import { apiClient } from "../../api/client";

const readErrorMessage = async (res: Response, fallback: string) => {
  const body = (await res.json().catch(() => null)) as { message?: string } | null;
  return body?.message ?? fallback;
};

const createItem = mutation.create<Item | null, void>({
  mutation: async () => {
    const data = await prompts.form({
      title: "New item",
      icon: "ti ti-plus",
      fields: {
        title: { type: "text", label: "Title", required: true },
        description: { type: "text", label: "Description", multiline: true },
      },
    });
    if (!data) return null;               // user cancelled

    const res = await apiClient.items.$post({ json: data });
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to create item"));
    return await res.json();
  },
  onSuccess: (created) => {
    if (!created) return;
    setItems((prev) => [created, ...prev]);
    toast.success("Item created");
  },
  onError: (err) => prompts.error(err.message),
});
```

```tsx
<button class="btn-primary btn-sm" disabled={createItem.loading()} onClick={() => createItem.mutate()}>
  {createItem.loading() ? <><i class="ti ti-loader-2 animate-spin" /> Creating…</> : <><i class="ti ti-plus" /> New item</>}
</button>
```

- Never create manual loading or error signals — `mutation` owns both.
- `onSuccess` handles local state, `toast.success`, navigation, or `refreshCurrentPath()`. `onError` handles `prompts.error`.
- `toast.success` for non-blocking confirmation; `prompts.error` for failures, because it blocks and stays readable for longer messages.
- `readErrorMessage` is a small app-local helper. There is no framework export for it — each app defines its own.

### Optimistic updates

`mutation.create` has an `onBefore` hook whose return value is handed to every later callback as a context object. Use it for optimistic state, rollback data, and a stale-response token — on drag-and-drop, WYSIWYG editing, and inline edits, where waiting for an SSR refresh feels broken. Plain create and delete flows stay with the simple pattern above.

Two things to get right, both of which have bitten Cloud apps:

- **Roll back in `onError` from the captured previous state**, not by refetching. The user's screen must return to what it showed before the failed drag.
- **Guard against a stale response.** Increment a token in `onBefore` and drop any result whose token is no longer current, or a slow earlier save will clobber a newer one.

The exact callback signatures are stdlib's — `bunx skills add valentinkolb/stdlib`. One trap worth naming here because it silently produces `undefined`: the **second argument to `onSuccess` and `onError` is the `onBefore` context, not the original variables.** Anything else you need, capture in the closure.

## State and navigation

| Situation | Use |
|---|---|
| One island owns the state | Solid signals inside that island |
| Parent coordinates a child | Props and callbacks |
| Selection or filter must survive reload, sharing, or back/forward | URL params |
| Two mounted islands must stay in sync | Typed `CustomEvent`, paired with `popstate` when URL-backed |
| Normal page, route, or query change | `navigateTo()` |
| Mutation where the server owns the refreshed view | `refreshCurrentPath()` |
| Sidebar target that needs fresh SSR data | `navigation="document"` |
| Mounted workspace can resolve the target itself | `onNavigate` + `nav.push()` / `nav.replaceWith()` |

### URL state

Filters, pagination, selected detail, and calendar view/date belong in URL params. The server can then render the selected state, and islands only initiate navigation.

In pages, read from the request URL. In islands, import the helpers from **`@valentinkolb/ssr/nav`** — they are not exported by `@valentinkolb/cloud/ui`:

```typescript
import { currentPathWithQuery, navigateTo, refreshCurrentPath } from "@valentinkolb/ssr/nav";

navigateTo("/app/my-app/123");   // full document navigation, adds a history entry
refreshCurrentPath();            // window.location.assign(currentPathWithQuery()) — full SSR re-render
```

`refreshCurrentPath()` is a real reload: it does not patch the DOM or preserve scroll.

For submit-driven search, `SearchBar` from `@valentinkolb/cloud/ssr/islands` reads the initial value from the URL and navigates on submit. It deliberately commits on submit — if nearby search in the same product updates while typing, do not make users learn two models; use the enhanced route-state pattern instead.

Do not hand-roll the parse/build/clear triple. `createUrlFilter` from `@valentinkolb/cloud/ssr` owns it, including the pagination base URL that eight pages previously derived by hand:

```typescript
import { createUrlFilter, flag, oneOf, page, text } from "@valentinkolb/cloud/ssr";

export const routeFilter = createUrlFilter("/admin/observability/telemetry", {
  range: oneOf("range", ["1h", "24h", "7d"] as const, "24h"),
  search: text("search"),
  errorsOnly: flag("errors"),
  page: page(),
});

const state = routeFilter.parse(new URL(c.req.url));      // in the page
routeFilter.build(state, { range: "7d" });                 // patch one field
routeFilter.paginationBase(state, "page");                 // always ends in `page=`
routeFilter.isActive(state, ["range"]);                    // a window is a scope, not a filter
routeFilter.clear(state, ["range"]);                       // keep the scope, drop the filters
```

Field values equal to their fallback are omitted, so the common URL stays clean, and `oneOf` rejects hand-edited values before they can reach SQL as an unvalidated interval or `ORDER BY`.

Conventions: filter, search, sort, and group changes use `replace`, reset `page` to `1`, usually clear the selected detail id, and use `scroll="preserve"`. Pagination may use `push` so browser back steps through pages. Filter chips commit on click, not on dropdown close.

Search inputs must keep focus while typing. Keep the visible value local to the search component, debounce the parent commit (200 ms is the default for enhanced route state), and never remount or re-key the input on route-state updates. Show a spinner in `TextInput`'s `suffix` slot while a commit is pending.

### Enhanced navigation

`@valentinkolb/ssr/nav` also exposes `navigate`, `documentNavigate`, `captureScroll`, `restoreScroll`, `startViewTransition`, and `Link`.

**All navigation goes through this library.** Do not wrap it, do not add an app-local navigation helper, and above all do not introduce a client-side router — Cloud is SSR-first and the server owns route state. `layout.update(...)` exists precisely so breadcrumbs can be kept in sync without anyone reaching for one.

Enhanced navigation must preserve real anchor behaviour — modifier clicks, new tabs, downloads, and external links fall back to normal browser navigation. Scroll modes are `"top"`, `"preserve"`, and `"manual"`. Mark scrollable regions with a stable `data-scroll-preserve` key, or `scrollPreserveKey` on `AppWorkspace.SidebarBody`, and let capture/restore handle them.

For a workspace where the sidebar and main area change together:

1. The SSR page stays the canonical reload and share path.
2. Extract the server-side route-state loader into a shared function.
3. Expose a small typed route-data endpoint that returns the same shape SSR would render.
4. One mounted workspace island owns the current route state.
5. In `onNavigate`, keep the real `href`, fetch route state, verify the target is fully handleable, set state, then `nav.push()`. Call `nav.fallback()` for anything outside the workspace.
6. If breadcrumbs change, publish the same server-computed array through `layout.update(...)`.

```tsx
import { layout } from "@valentinkolb/cloud/ui";

<AppWorkspace.SidebarItem
  href={`/app/my-app/${workspaceId}/items/${itemId}`}
  scroll="top"
  onNavigate={async (nav) => {
    if (!parseWorkspaceHref(nav.url)) return nav.fallback();
    const res = await apiClient.workspace.route.$get({ query: { href: `${nav.url.pathname}${nav.url.search}` } });
    if (!res.ok) return nav.fallback();
    const next = await res.json();
    if (next.kind !== "ok") return nav.fallback();

    setWorkspaceState(next);
    layout.update({ breadcrumbs: next.title, title: next.title.at(-1)?.title });
    nav.push();
  }}
>
  Item
</AppWorkspace.SidebarItem>
```

`layout.update(...)` is progressive enhancement only — the SSR page must still pass the same breadcrumbs on reload. **Never duplicate permission checks, entity resolution, or query merging in the browser.** The server stays the source of truth for route state.

Links leaving the current workspace context keep document navigation.

### URL-backed detail panels

The Cloud contract: **the URL is the canonical selection.** A window event only syncs islands that are already mounted; it never becomes the source of truth. Never hold canonical selection in a local signal on an SSR list/detail page — reload, sharing, and back/forward all break.

`detailPanel` from `@valentinkolb/stdlib/solid` implements the mechanics (read the param, write it, dispatch the event, decide whether a click is eligible). Wrap it once per app in a small module that names your param and event, then use that everywhere — see the `stdlib` skill for its API.

Render entries as real anchors with `href`, intercept only eligible plain left-clicks, then `preventDefault()` and update the URL-backed state:

```tsx
<a
  href={buildItemUrl(item.id)}
  onClick={(event) => {
    if (!shouldHandleDetailClick(event)) return;
    event.preventDefault();
    selectItemInUrl(item.id, item);
  }}
>
  {item.title}
</a>
```

Event payloads are ephemeral: listeners must tolerate `item: null`, and reload or `popstate` flows must rehydrate from the URL, the server render, or the API. Use hard SSR navigation instead when selecting an item genuinely requires server-rendered detail data.

### Typed window events

For loose coupling between islands that cannot share Solid state. Keep names and payload types in a plain `.ts` module so server components can import the constants without pulling browser code into SSR.

- Define constants once; never inline the string literal across components.
- Type the `CustomEvent` payload at the listener boundary.
- Register in `onMount`, remove in `onCleanup`.
- Pair with `popstate` when the URL is part of the state.
- Do **not** use window events for parent-child communication, single-island state, form state, or mutation lifecycle.

## Live updates

For UI metadata that should update live but is safe to heal by reload, use a Redis-backed `@valentinkolb/sync` `topic()` on the server and `createLiveWebSocket` from `@valentinkolb/cloud/browser/live` in the browser. The helper owns visibility-aware pause/resume, reconnect backoff, applied-cursor resume, and cleanup. The app owns its typed wire messages, runtime validation, resource permissions, and event handling.

The database stays the only source of truth. If an event is missed, a reload or targeted refetch must reconstruct correct state. Protocol contract in `backend.md`.

`@valentinkolb/sync/browser` is an in-memory browser implementation of the sync primitives — not a server transport. The server topic is the replayable log; the WebSocket is only its delivery channel.

## View transitions

Enabled globally through `<meta name="view-transition" content="same-origin">`. **Always set `view-transition-name` on elements that persist across navigations** — cards, headers, sidebars, tables. This is not optional.

It matters most because of the multi-container architecture: navigating from `/app/spaces` to `/app/contacts` hits a different Bun process, but because both use the same `Layout` and set the same names on the shared chrome, the browser animates it as if it were one SPA.

```jsx
<div style="view-transition-name: admin-logs-title">…</div>
<a href={`/app/my-app/${item.id}`} style={`view-transition-name: item-card-${item.id}`}>…</a>
```

Naming convention is `{app}-{element}-{id?}`. For lists, use a small helper:

```typescript
const vt = (key: string) => `my-app-sidebar-${key}`;
```

## Icons

Tabler Icons as CSS classes: `<i class="ti ti-star" />`, `<i class="ti ti-loader-2 animate-spin" />`. Browse at [tabler-icons.io](https://tabler-icons.io).

Every icon-only control needs an accessible name and, where the meaning is not obvious, a `Tooltip`.
