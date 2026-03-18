---
name: cloud-frontend-consistency
description: Use when building or refactoring frontend pages and islands to keep SSR-first behavior, shared client components, accessibility-first interaction, and UI consistency.
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

## Quick Lookup (Do Not Guess)

- Browser helpers (`mutation.create`, `detailPanel`):
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
- Shared `SearchBar` and form inputs instead of ad-hoc controls.
- For filter-heavy pages, pair this skill with `../cloud-query-state-patterns/SKILL.md`.

## Design Language (Refined)

- Avoid heavy Bootstrap-like boxes and button clutter.
- Prefer spacing, grouping, and subtle surfaces (`paper`) over hard borders everywhere.
- Keep hover/focus states clear but not noisy.
- Use icon-only actions where semantics are clear; keep text labels where clarity is needed.

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
5. Keep desktop sidebar surface neutral:
   - No additional local border/background wrappers around `sidebar-container`
6. Add stable `view-transition-name` values for key sidebar actions and nav rows on high-frequency pages.

## Flexibility Rule

- This is a design grammar, not a strict template.
- New layouts are welcome if they remain accessible, consistent, and maintainable.

## References

- Frontend architecture and mutation/prompt patterns: `references/frontend-patterns.md`
- Shared components and layout recipes: `references/component-catalog.md`
- Sidebar utility class recipes: `references/sidebar-utilities.md`

## Reference Routing

- Read `references/frontend-patterns.md` for SSR/island split, mutation, prompt, and accessibility behavior.
- Read `references/component-catalog.md` when composing page layout and choosing shared UI primitives.
