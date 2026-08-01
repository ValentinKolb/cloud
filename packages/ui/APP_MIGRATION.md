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

Component styles are descendant-scoped below `.k2b-ui`. Until the Cloud shell
owns that scope globally, place one outer `.k2b-ui` wrapper around the migrated
app content. The wrapper must contain the component root; adding `k2b-ui` to
the component root itself does not match descendant selectors. Do not add a
wrapper around every component. Mark the app-local wrapper as temporary and
remove it when the Cloud shell provides the global scope.

## 3. Convert to canonical public APIs

Use the `@k2b/ui` source, types, and Fibel examples as the contract. Preserve
the app's behavior while adopting the canonical API in one pass, especially:

- `value` and `onValueChange` for controlled components;
- shared field metadata such as `label`, `description`, `error`, `required`,
  `disabled`, and native ARIA attributes;
- canonical component names recorded in `migration-inventory.json`.

Do not recreate removed aliases such as `SwitchInput`, and do not replace a
component with a smaller substitute that loses behavior.

## 4. Remove the old path

Delete an app-local TypeScript path alias when no source file uses it. The
following gate must return no matches:

```sh
rg -n '@valentinkolb/cloud/(ui|ai/ui)' packages/<app>
```

Cloud-owned imports such as `@valentinkolb/cloud/ssr` are expected to remain.

## 5. Verify the cut

Run the smallest complete evidence set for the app:

1. package typecheck and focused tests;
2. package or app build, including SSR and browser conditions;
3. route smoke with and without client hydration where applicable;
4. light and dark theme, narrow and wide layout;
5. keyboard operation, focus restoration, labels, errors, and disabled states;
6. final legacy-import and diff checks.

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
API, add one temporary outer .k2b-ui scope only if the host does not provide it,
remove the unused legacy alias, and preserve behavior without shims.
```

### Child 3: verify and commit

```text
Require zero legacy UI imports, then run typecheck, focused tests, build, route,
theme, responsive, and accessibility checks appropriate for <app>. Inspect and
commit only the owned paths and lockfile hunk with a Conventional Commit.
```
