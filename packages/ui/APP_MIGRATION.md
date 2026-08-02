# Cloud app migration to `@k2b/ui`

Migrate one app at a time as a hard cut. A migrated app imports portable UI
directly from `@k2b/ui`; it does not add aliases, re-exports, or compatibility
wrappers for the legacy Cloud UI.

## 1. Freeze the app boundary

Start from the app package and inventory every legacy UI import:

```sh
rg -n '@valentinkolb/cloud/(ui|ai/ui)' packages/<app>
git status --short packages/<app> packages/ui bun.lock
```

Classify each dependency before editing:

- **portable UI** moves to `@k2b/ui`;
- **Cloud-owned runtime** stays in Cloud, including `Layout`, authentication,
  API clients, permissions, routes, and protocol adapters;
- **app-owned behavior** stays in the app, including state, persistence,
  domain types, and business rules.

Do not broaden the migration into an application redesign.

## 2. Add the direct package and style boundary

Built-in apps depend on the workspace package directly:

```json
"@k2b/ui": "workspace:*"
```

External consumers install the published package version instead. Import
`@k2b/ui/styles.css` once in the host application as described in the Getting
Started guide.

Component styles are descendant-scoped below `.k2b-ui`. Cloud's shared HTML
shell owns that scope on `<body>`, so built-in apps must not add app-local
`.k2b-ui` wrappers. External hosts add one outer scope around their UI as
described in the Getting Started guide; it must contain the component root
because adding `k2b-ui` to the component root itself does not match descendant
selectors.

Cloud also marks that document scope with `data-k2b-app-workspace-controller`.
This declares the shell as the single resize-controller owner for both SSR and
hydrated workspaces. Standalone consumers omit the marker and keep the local
controller installed by `AppWorkspace`.

An SSR host that persists workspace geometry wraps its rendered page content
in `AppWorkspace.LayoutStateProvider`. The provider projects the initial width
and collapse state onto each workspace root, so server HTML and the first
client render agree before the controller attaches. Cloud passes its
cookie-derived state from `Layout`; individual apps must not read the cookie or
reimplement this bridge. A built-in app therefore normally renders plain
`<AppWorkspace>` and uses region props such as `MainPane.defaultSize` for its
own defaults. Do not pass a hard-coded root `layoutState`: it overrides the
cookie-backed server render and produces a width or collapse snap on hydration.

## 3. Convert to canonical public APIs

Use the `@k2b/ui` source, types, and Fibel examples as the contract. Preserve
the app's behavior while adopting the canonical API in one pass, especially:

- `value` and `onValueChange` for controlled components;
- shared field metadata such as `label`, `description`, `error`, `required`,
  `disabled`, and native ARIA attributes;
- canonical component names recorded in `migration-inventory.json`.

Do not recreate removed aliases such as `SwitchInput`, and do not replace a
component with a smaller substitute that loses behavior.

### Shared workspace shell ownership

`AppWorkspace` owns the structural geometry of its regions. In particular,
`AppWorkspace.Detail` provides the outer detail inset and spacing; applications
must not repeat that contract with `p-*`, `!p-*`, negative margins, or an
app-local wrapper around the detail region. Detail content starts with the
shared `detail-header` and `detail-stack` patterns where applicable.

Do not add a local flush workaround when an application needs edge-to-edge
content. First verify whether that is a real shared use case and, if so, evolve
the public `AppWorkspace` contract with a documented and tested API. One-off
CSS exceptions make workspace geometry inconsistent across applications.

## 4. Remove the old path

Delete an app-local TypeScript path alias when no source file uses it. The
generic legacy UI gate must return no matches:

```sh
rg -n '@valentinkolb/cloud/(ui|ai/ui)' packages/<app>
```

Cloud-owned imports such as `@valentinkolb/cloud/ssr`,
`@valentinkolb/cloud/ai/ui`, or another focused Cloud protocol subpath are
expected to remain. Do not import Cloud-specific adapters through the generic
`@valentinkolb/cloud/ui` barrel.

Imports are only half of the cut. Inventory legacy Cloud UI utility classes as
well; otherwise an app can compile against `@k2b/ui` while its controls still
depend on the old host stylesheet:

```sh
rg -n --glob '*.tsx' --glob '*.ts' \
  'class=.*\b(btn|sidebar|workspace|panel|input|table|badge)-' \
  packages/<app>/src
```

Replace portable controls with their canonical `@k2b/ui` components and props.
For each remaining match, record why it is Cloud-owned or app-owned. An
unclassified legacy utility match means the hard cut is incomplete; a green
typecheck or build does not override this gate.

Compilation also cannot prove that a retained app-owned class still has a
definition. For every retained class that is not an ordinary utility, search
both its JSX usage and stylesheet definition. A stale class can preserve the
expected DOM shape while silently losing its visual contract.

Imports and legacy class names still do not cover the full public boundary.
Inventory native interactive elements, direct `k2b-*` implementation classes,
and string props that look like utility classes:

```sh
rg -n --glob '*.tsx' --glob '*.ts' \
  "<(button|input|select|textarea|dialog)\\b|createElement\\([\"'](button|input|select|textarea|dialog)[\"']\\)" \
  packages/<app>/src
rg -n --glob '*.tsx' --glob '*.ts' '\bk2b-(button|icon-button|input|select|dropdown)\b' packages/<app>/src
rg -n --glob '*.tsx' 'width="w-[0-9]' packages/<app>/src
rg -n --glob '*.tsx' 'layoutState=|--k2b-workspace-(sidebar|detail|drawer)' packages/<app>/src
```

Ordinary actions and fields use public `@k2b/ui` components. Native elements
remain valid for domain composites, editor widgets, graphical canvases, and
imperative renderers where a Solid component cannot own the DOM; classify each
exception instead of wrapping it mechanically. Application code must not style
itself through internal `k2b-*` implementation classes. If a real public shape
is missing, add the smallest reusable primitive to `@k2b/ui` with a focused
test rather than copying its internal class contract.

Treat prop values according to their public type and documentation. In
particular, CSS-length props such as `Dropdown.width` receive values like
`"12rem"`, not utility names such as `"w-48"`. A string-typed prop can pass
typecheck while remaining inert at runtime, so this is an explicit source gate.

When a legacy component combines a portable visual primitive with a product
endpoint or protocol, keep the product knowledge in a small focused adapter.
For example, an Accounts avatar adapter may derive the authenticated avatar URL
and pass it to the portable `Avatar`; the URL must not leak into `@k2b/ui`.
Compare the old fallback, accessible name, loading, and error semantics before
replacing the component. The same boundary applies to product-owned composites
such as entity search and avatar upload: expose them from a focused Cloud
subpath, never from the generic legacy UI barrel.

### SSR and hydration parity

Treat the server render as part of the UI contract. For every migrated
`AppWorkspace`, hard-reload at a non-default persisted sidebar width and in the
collapsed state. The first rendered geometry and visible labels must match the
hydrated result without a width snap or a brief expanded-label flash.

Nested navigation rendered from runtime data must also survive hydration. Use
stable item ids and a controlled `expandedIds` / `onExpandedIdsChange` pair
when the application owns expansion state. Verify that dynamic children (for
example children rendered through Solid `<For>`) remain present and keyboard
operable after a hard reload. Do not replace this proof with a client-only
navigation smoke.

Keep server and browser assertions separate. Raw SSR tests prove initial HTML;
hydrated geometry checks run only after the document stylesheet has loaded and
must re-resolve elements after an island replaces server DOM. Do not measure
layout immediately after `domcontentloaded` or keep stale element handles
across hydration.

Migration smokes must use roles, accessible names, public semantic markup, or
an explicitly app-owned integration hook. Do not locate elements through
private shared-component classes: those selectors couple the app to an
implementation detail and make a correct hard cut look broken.

## 5. Verify the cut

Run the smallest complete evidence set for the app:

1. package typecheck and focused tests;
2. package or app build, including SSR and browser conditions;
3. route smoke with and without client hydration, including persisted workspace
   width/collapse state and dynamic navigation where applicable;
4. light and dark theme, narrow and wide layout;
5. keyboard operation, focus restoration, labels, errors, and disabled states;
6. final legacy-import, native-control, direct implementation-class, prop-value,
   retained-class-definition, smoke-selector, and diff checks.

Prefer the package's declared scripts (for example `bun run typecheck` and
`bun run test`) over reconstructing their underlying commands. The scripts may
provide safe fixture environment, filters, or setup that belongs to the app's
test contract; bypassing them can create migration failures that do not exist
in the supported workflow.

The final legacy check covers both imports and unclassified Cloud utility
classes from section 4.

### Shared component impact check

A change to a shared layout or base component can affect applications that are
already migrated. Before committing such a change, inventory every current
consumer and classify whether it follows the shared contract. For example:

```sh
rg -n 'AppWorkspace\.Detail' packages --glob '*.tsx'
rg -n 'AppWorkspace\.Detail[^>]*class=' packages --glob '*.tsx'
```

Remove redundant app-local geometry and stop if a consumer intentionally needs
a different contract. Then run the full shared-package tests, typecheck every
affected migrated application, and rebuild or restart affected development
containers when their image embeds the package build. Only then visually smoke
the Fibel showcase plus the affected application shells at narrow and wide
widths. Record the consumer search and verification evidence in the migration
task; a green shared-package test or a stale running container is not
sufficient.

For `AppWorkspace.Detail`, explicitly verify that the shared inset is present
once: the workspace region owns it and the application child starts at zero
outer padding. Check both an open desktop detail and its narrow overlay state so
the shared change cannot introduce double padding or clipped content.

If a check fails, fix the package contract or the app usage at its owner. Do
not hide a failure behind a local shim.

## 6. Commit only the owned slice

In a dirty worktree, stage exact app and documentation paths. Stage only the
relevant `bun.lock` hunk, inspect the cached diff, then use a focused commit:

```sh
git diff --cached --check
git diff --cached --stat
git commit -m 'refactor(<app>): migrate app to k2b ui'
```

## Dex template

Use one parent task for the migration and three small children. Large apps can
split the conversion child by independent frontend area.

### Parent

```text
Hard-cut <app> from @valentinkolb/cloud/ui to @k2b/ui. Preserve Cloud-owned
runtime and app-owned behavior, add no compatibility shims, and finish with a
verified focused commit.
```

### Child 1: inventory and boundary

```text
Inventory every legacy UI import in <app>. Classify portable, Cloud-owned, and
app-owned dependencies. Record the direct package, CSS scope, API conversions,
and verification commands before implementation.
```

### Child 2: migrate the app

```text
Add @k2b/ui as a direct dependency, migrate every portable import and canonical
API, rely on the shared Cloud scope, remove the unused legacy alias, and
preserve behavior without shims.
```

### Child 3: verify and commit

```text
Require zero legacy UI imports and classify every remaining native control,
direct implementation class, and utility-shaped component prop. Then run
typecheck, focused tests, build, route, theme, responsive, and accessibility
checks appropriate for <app>. Inspect and commit only the owned paths and
lockfile hunk with a Conventional Commit.
```
