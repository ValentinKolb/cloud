# Cloud CSS architecture baseline

This baseline freezes the production UI before the global CSS consolidation. It is intentionally executable through `bun run check:css` so cleanup commits cannot silently add new stylesheet owners, cross-app scans, duplicate utilities, or a second development/production build path.

## Current ownership

- `packages/cloud/src/styles/global.css` is the only shared entrypoint. It imports Tailwind and every shared stylesheet exactly once.
- `packages/cloud/src/styles/tokens.css` is the intended owner of semantic `--ui-*` tokens.
- `packages/cloud/src/styles/utilities-*.css`, `effects.css`, `input.css`, `base-popover.css`, and the editor-specific styles own concrete primitives.
- App `src/styles/app.css` files own only app-local Tailwind scanning, vendor integration, and genuinely app-specific styling.
- Runtime layout and appearance variables remain owned by TypeScript: `--app-*`, `--workspace-*`, editor-local variables, and component-local variables are not global design tokens.

## Migration debt frozen by the gate

The gate names the remaining exceptions instead of treating them as valid architecture:

- `theme-modern.css` is a late 934-line override layer. Its token values must move to `tokens.css`; its component rules must move to their primitive owners; the file must then be deleted.
- `bg-dark`, `ellipsis`, and `no-scrollbar` each have two shared owners.
- Gateway and Venue still import full Tailwind instead of scoped utilities.
- Pulse has a comment-only app stylesheet rather than the standard scoped entrypoint.
- Internal shared CSS still consumes legacy `--theme-*` aliases.

Each exception is an explicit finite list in `scripts/check-css-architecture.ts`. A cleanup commit removes an exception from that list together with the obsolete CSS.

## Protected behavior

Cleanup must preserve:

- AppWorkspace sidebar, mixed main panes, detail panes, bottom drawer, SSR-safe widths/collapse state, resize handles, and edge shadows.
- Mail's split-main composition without editing Mail-owned files during this epic.
- App accent/canvas identity in light and dark mode.
- DataTable hover/selection behavior, feedback blocks, menus/popovers/tooltips, dialogs, completion/editor overlays, and portal/floating-window surfaces.
- Responsive, reduced-motion, touch, and keyboard/focus behavior.
- App-specific CodeMirror, KaTeX, and other vendor selectors that require documented specificity.

## Verification matrix

Every slice runs `bun run check:css`, `git diff --check`, and the narrow formatter/typecheck/build for the touched owner. Milestone reviews additionally run the shared Cloud build and AppWorkspace state tests. Final acceptance adds representative light/dark and responsive browser smoke checks for Core, Assistant, Contacts, Spaces, Tools, Notebooks, Grids, and Mail while leaving Mail source untouched.

Automated analysis is supporting evidence only: duplicate declarations are actionable, while arbitrary CSS-variable Tailwind classes and documented vendor selectors require semantic review before deletion.
