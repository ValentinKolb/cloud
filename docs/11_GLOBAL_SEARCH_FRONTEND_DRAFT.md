# Global Search Frontend (Spotlight v1)

Status: Implemented.

## UX

1. Open with `mod+k` from anywhere in authenticated app views.
2. Spotlight dialog keeps a fixed search field position while loading/results change.
3. Desktop (`md+`) uses two columns:
   - left: result list
   - right: active result preview/details
4. Mobile (`<md`) shows list only (preview panel hidden via CSS).
5. `Esc` closes the dialog.
6. Spotlight is top-anchored and grows only downward.

## Tags

Tag parsing happens client-side from the raw input:

1. tokens starting with `#` are treated as tags
2. tags are normalized to lowercase
3. duplicate tags are removed
4. free-text query is the remaining input

Examples:

1. `#note test`
2. `report #file #excel`

## Keyboard

1. `ArrowUp` / `ArrowDown`: move active result
2. `Enter`: open active result

## Backend Contract

Endpoint remains:

- `GET /api/search?q=<query>&tag=<tag>&provider_limit=<1..99>`

Returned items may include:

1. `metadata?: Array<{ label: string; value: string }>`
2. `previewUrl?: string` (must be app-local path starting with `/`)
3. input tags passed to providers as `tags: string[]`

## Provider Rules

1. Providers must honor `limit` exactly.
2. Providers can declare optional `search.tags` in capabilities.
3. Providers should apply AND semantics for requested tags (`every`).
4. Providers should avoid extra heavy queries for search metadata.
5. Providers must return app-local hrefs/preview paths only.
6. API remains fail-open per provider (invalid item or provider error does not fail whole response).
