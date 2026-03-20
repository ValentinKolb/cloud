---
name: cloud-frontend-consistency
description: Use when building or refactoring frontend pages, islands, admin consoles, and data-heavy list/table views in this repo to keep SSR-first behavior, URL-driven state, shared client components, accessibility-first interaction, and consistent compact full-width layouts.
---
# Cloud Frontend Consistency

Use this skill for frontend architecture, interaction patterns, and visual consistency.

## Core Rules

1. SSR-first pages, islands only where interaction is needed.
2. URL is source of truth for search/filter/pagination/detail state.
3. Use shared client components before building local variants.
4. Accessibility first (focus, labels, keyboard, semantics).
5. Keep refined design language coherent without forcing one rigid layout.
6. Prefer shared client components and islands over local ad-hoc controls.

## Recent Learned Rules (Must Follow)

1. Disabled behavior must come from semantic elements and shared utilities.
   - Use real `button`/`input` elements with `disabled`.
   - Do not emulate disabled with wrapper opacity classes.
   - If an action callback is missing (`onChange`, `onClick`), component must auto-disable related controls.
2. Segmented control active state must stay minimal and singular.
   - No double border/ring stacks on active item.
   - Keep compact sizing and consistent rounding between container and active segment.
   - Keep divider rendering CSS-first; show dividers only between inactive neighbors.
3. UI Lab is the visual contract for shared primitives.
   - If UI Lab defines a disabled/hover/focus behavior, domain components must reuse it instead of local overrides.
   - Align component disabled states with UI Lab button/input states before adding custom styles.
4. Data-heavy admin pages must stay open and compact.
   - Prefer full-width layouts with one clear working surface over narrow centered cards.
   - Use spacing, typography, and row density to create hierarchy before adding more containers.
   - Keep table rows scan-first; expanded detail belongs in a dialog or panel, not inline in the row.
5. Admin/list page headers should stay quiet and live on the page background.
   - Prefer a simple title block: page title + one short secondary line directly underneath.
   - Do not wrap that title block in `paper` unless the page is form-heavy rather than table-heavy.
   - Put search, filters, and actions below the title block as their own rows.
6. Desktop app sidebars should now be real surfaces.
   - Use `sidebar-container` only for column sizing and placement.
   - Inside it, render one `paper flex h-full min-h-0 flex-col gap-4 p-4` surface.
   - Keep the header as a simple local flex row with icon + title (+ optional settings action).
   - Let the sidebar content use `sidebar-group`, `sidebar-body`, and `sidebar-footer`; do not reintroduce extra outer wrappers.

## Quick Lookup (Do Not Guess)

- Browser helpers (`mutation.create`, `detailPanel`):
  - includes `dnd.create(...)` for desktop-style drag and drop
  - import: `@valentinkolb/cloud/lib/browser`
  - source: `cloud/packages/lib/src/browser/index.ts`
- UI prompt helpers (`prompts.*`):
  - import: `@valentinkolb/cloud/lib/ui`
  - source: `cloud/packages/lib/src/ui/prompts.tsx`
- Shared utilities (`markdown`, `dates`, `calendar`, `encoding`, `fileIcons`, `icons`, `gradients`):
  - import: `@valentinkolb/cloud/lib/shared`
  - source: `cloud/packages/lib/src/shared/index.ts`
- Shared UI exports:
  `cloud/packages/lib/src/ui/index.ts`
- Shared islands exports (currently only `SearchBar`):
  `cloud/packages/lib/src/islands/index.ts`
- Global style language:
  `cloud/packages/lib/src/styles/global.css`
  `cloud/packages/lib/src/styles/utilities-layout.css`
  `cloud/packages/lib/src/styles/utilities-buttons.css`
  `cloud/packages/lib/src/styles/utilities-navigation.css`

## Interaction Patterns to Prefer

- `mutation.create(...)` for async UI state and errors.
- `prompts.error(...)`, `prompts.confirm(...)`, `prompts.dialog(...)` for user feedback/dialogs.
- Use app-scoped typed API clients:
  - `import { apiClient } from "@/<app>/client"` (uses tsconfig `@/*` path alias)
  - no global built-in apps client
  - cross-app calls use the same alias: `from "@/<other-app>/client"`
- URL-driven detail panel via `detailPanel` helpers when preserving scroll is important.
- Shared `dnd.create(...)` for accessible pointer/keyboard drag-and-drop before writing local drag systems.
- Shared `SearchBar` and form inputs instead of ad-hoc controls.
- For filter-heavy pages, pair this skill with `../cloud-query-state-patterns/SKILL.md`.

## Design Language (Refined)

- Avoid heavy Bootstrap-like boxes and button clutter.
- Prefer spacing, grouping, and subtle surfaces (`paper`) over hard borders everywhere.
- Keep hover/focus states clear but not noisy.
- Use icon-only actions where semantics are clear; keep text labels where clarity is needed.
- For admin/data pages, default to full-width and dense rather than centered and card-heavy.
- If a page is mostly a table, let the table own the page instead of nesting it inside extra panels.

## Sidebar Utility Convention (Must Follow)

1. Build app sidebars directly in the app with utility classes; do not introduce local sidebar builder abstractions.
2. Use these structural classes:
   - Desktop: `sidebar-container`, `sidebar-header`, `sidebar-group`, `sidebar-body`, `sidebar-footer`
   - Mobile: `sidebar-container-mobile`, `sidebar-mobile-toggle`, `sidebar-mobile-actions`, `sidebar-item-mobile`
3. Keep spacing consistent:
   - Small gap inside a group (`sidebar-group` content)
   - Larger gap between groups (`flex flex-col gap-3` at group wrapper level)
4. Keep mobile simple:
   - Render flat pill actions in `sidebar-mobile-actions`
   - Avoid heavy settings/control blocks on mobile unless explicitly required
5. Keep desktop sidebar as one calm surface:
   - `sidebar-container` places the column
   - a single inner `paper` surface owns border, background, and padding
   - do not nest multiple cards inside the sidebar shell unless the content itself needs a sub-surface
6. Add stable `view-transition-name` values for key sidebar actions and nav rows on high-frequency pages.

## Data View Pattern

Use for admin tables, audit/history pages, request queues, user/group lists, and other dense list/detail screens.

**Canonical example:** `cloud/packages/apps/src/logging/frontend/`

Read `references/table-view-pattern.md` for the full pattern.

Keep these rules in mind:
1. SSR page owns data loading, pagination, and filter parsing.
2. Search/filter state lives in the URL.
3. Prefer one filter/action island and one table island when the page is interactive.
4. Keep the page full-width and compact; avoid wrapping the table in unnecessary extra layout boxes.
5. Keep rows single-line and scan-friendly; open rich detail in a dialog or panel.
6. Structured payloads should be formatted first and only show raw JSON as an optional secondary view.
7. For app-level list pages, use the same quiet title treatment as admin pages: simple background header, then search/filter rows, then the table.
8. For desktop-like managers (files, spaces, mail-like UIs), keep single-click, double-click, selection, and context-menu behavior consistent across views.
   - Use one shared action vocabulary for row/tile menus instead of separate per-view action sets.
   - If drag-and-drop is needed, prefer `dnd.create(...)` and keep drop targets explicit and semantic.
9. For desktop-like managers with side detail panels:
   - let the panel host fill the whole column with no extra outer margin/padding
   - keep the header minimal; remove redundant helper copy once the interaction is obvious
   - put dense metadata into one calm facts surface and avoid repeating the same data above and inside that surface

## Flexibility Rule

- This is a design grammar, not a strict template.
- New layouts are welcome if they remain accessible, consistent, and maintainable.

## References

- Frontend architecture and mutation/prompt patterns: `references/frontend-patterns.md`
- Shared components and layout recipes: `references/component-catalog.md`
- Sidebar utility class recipes: `references/sidebar-utilities.md`
- Data table, filter bar, and detail-dialog pattern: `references/table-view-pattern.md`

## Reference Routing

- Read `references/frontend-patterns.md` for SSR/island split, mutation, prompt, and accessibility behavior.
- Read `references/component-catalog.md` when composing page layout and choosing shared UI primitives.
- Read `references/table-view-pattern.md` when building admin tables, list/detail views, or any compact full-width data page with search, filters, and row details.
