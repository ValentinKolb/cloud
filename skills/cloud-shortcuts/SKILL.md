---
name: cloud-shortcuts
description: Use when adding or refactoring keyboard shortcuts in app frontends to keep a consistent hotkey convention, avoid duplicate registrations, and preserve accessibility.
---
# Cloud Shortcuts

Use this skill when implementing keyboard shortcuts in app islands/pages.

## Core Rules

1. Keep shortcuts minimal and high-value.
2. Register shortcuts once per page context (avoid duplicate registrations from mobile+desktop duplicates).
3. Use the shared browser hotkeys utility:
   - import from `@valentinkolb/cloud/lib/browser`
   - API: `hotkeys.create(...)`, `hotkeys.entries()`
4. Always provide `label` and a short `desc` for help dialogs.
5. Do not create app-specific keychain systems in normal app code.

## Shortcut Conventions

1. Avoid overriding browser/system default shortcuts (for example `mod+f`, `mod+n`, `mod+t`, `mod+w`, `mod+l`, `mod+r`).
2. Use a shared app-search convention: `mod+shift+k`.
3. Typical app-local defaults:
   - `mod+shift+k` opens the current app search (or focuses it).
   - `mod+alt+n` creates the app's primary entity (only when write/create is allowed).
4. Reserve global combos for future global UX:
   - `mod+k` command palette (global)
   - `mod+shift+p` optional command palette fallback
   - `mod+shift+f` command palette in search mode (global)

## Input Behavior

1. Default behavior should "just work":
   - plain keys do not fire inside text inputs/editors
   - modifier combos still work (`mod+...`, `alt+...`)
2. Only opt in to in-input shortcuts when there is a clear UX reason.

## Placement Pattern (Important)

1. Prefer a dedicated page-level shortcuts island that returns `null`.
2. Do not register the same shortcut in both mobile and desktop sidebar variants.
3. If an editor consumes a combo, bridge intentionally via one app event hook.

## UX Help Pattern

1. Surface active shortcuts in a help dialog using `hotkeys.entries()`.
2. Render `keysPretty` tokens directly; avoid custom string parsing.
3. Keep help copy user-facing and simple.

## Quality Gates

Run and pass:

1. `bun run check:biome`
2. `bun run --filter @valentinkolb/cloud-apps typecheck`
3. `bun run --filter @valentinkolb/cloud-core typecheck`

## References

- Shortcut mapping and reserved combos:
  `references/shortcut-conventions.md`
