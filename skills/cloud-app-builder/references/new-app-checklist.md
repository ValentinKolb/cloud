# New App Checklist

## Minimum File Layout

- `index.ts`
- `service/index.ts`
- `api.ts` (if app exposes API)
- `pages.ts` (if app exposes pages)
- `frontend/*` (SSR pages + islands)

## Facade Contract

- default export: app facade
- named runtime export: `service`
- type export: `ApiType` when API exists
- optional capabilities via `capabilities` (for cross-app features)

## Service Contract

- stateless object facade
- config-object method args
- `list` paginated + optional filter
- `get` returns item or `null`

## API Contract

- middleware before routes
- validation at route edge
- service call for domain logic
- HTTP mapping through `respond(...)`

## Frontend Contract

- SSR-first pages
- islands for interaction
- URL-state for search/filter/pagination/detail
- shared client components first
- for filter-heavy screens, define query key/default contract first
- for hybrid detail, validate back/forward and scroll preservation

## Search Capability (Optional)

- optionally define `capabilities.search.tags` for tag-aware global search
- expose `capabilities.search.run({ query, tags, limit, ctx })` in app `index.ts`
- read authenticated user via `ctx.get("user")`
- honor provider-local `limit` exactly
- return app-local hrefs
- keep optional `priority` in `0..9`
- optional details via `metadata: Array<{label,value}>`
- optional preview image via `previewUrl` (`/...` only)

## Lifecycle (Optional)

Use app lifecycle only when needed:

- `setup` for migrations/init
- `start` for background runtime behavior
- `stop` for shutdown cleanup
