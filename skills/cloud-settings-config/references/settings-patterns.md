# Settings Patterns

## Key Design

- Namespace: `group.key`.
- Defaults defined in code registry.
- Env fallback optional per setting.
- Runtime resolution via settings service.

## Where To Change

- Registry/defaults:
  `cloud/packages/core/src/services/settings/defaults.ts`
- Runtime read/write/cache:
  `cloud/packages/core/src/services/settings/index.ts`

## App-level Registration

Use in app service init when adding app-specific keys:

```ts
registerGroupLabel("weather", "Weather");
registerSettings([{ key: "weather.geo_url", type: "string", default: "", group: "weather", description: "Geo API URL" }]);
```

## Runtime Usage

- `getSync<T>(key)` for sync access after cache load.
- `get<T>(key)` async variant.
- `set/remove` for admin updates.

## URL/Cookie/Runtime Precedence

For user-facing preferences (view mode, panel width, include flags), keep precedence deterministic:

1. URL query override (most specific)
2. Cookie/user preference fallback
3. Code default

Rules:

- Parse cookies safely (never throw).
- Migrate old cookie shapes in one helper.
- Write cookie values through one store module per feature.

## Safety and UX

- Unknown keys fail clearly.
- Keep admin labels/descriptions clear for non-developers.
- Do not hardcode deployment-specific values in defaults.
