# Cloud Shortcut Conventions

## Primary Conventions

1. Avoid overriding browser/system defaults (`mod+f`, `mod+n`, `mod+t`, `mod+w`, `mod+l`, `mod+r`).
2. Use `mod+shift+k` as app-local search shortcut.
3. Use:
   - `mod+shift+k` for app-local search.
   - `mod+alt+n` for creating the app's primary entity.

## Reserved Global Combos

1. `mod+shift+p` reserved for global command palette.
2. `mod+k` preferred global command palette shortcut.
3. `mod+shift+f` reserved for global search mode in command palette.

## Registration Pattern

1. Register shortcuts once in a page-level island (return `null`).
2. Avoid duplicate registrations from responsive desktop/mobile duplicates.
3. Include `label` and `desc` for each shortcut so help dialogs can render useful context.

## Input Rule

1. Plain keys should not fire inside text inputs/editors.
2. Modifier combos should still work inside text inputs/editors.
3. Only opt into in-input plain keys when explicitly needed.
