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
reimplement this bridge.

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

## 5. Verify the cut

Run the smallest complete evidence set for the app:

1. package typecheck and focused tests;
2. package or app build, including SSR and browser conditions;
3. route smoke with and without client hydration where applicable;
4. light and dark theme, narrow and wide layout;
5. keyboard operation, focus restoration, labels, errors, and disabled states;
6. final legacy-import and diff checks.

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
Require zero legacy UI imports, then run typecheck, focused tests, build, route,
theme, responsive, and accessibility checks appropriate for <app>. Inspect and
commit only the owned paths and lockfile hunk with a Conventional Commit.
```
