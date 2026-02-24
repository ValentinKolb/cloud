# URL State Contract

## Goal

Keep every query-driven screen deterministic across refresh, deep-link, and back/forward.

## Contract Checklist

1. Define all query keys in one place (`const QueryParams = { ... } as const`).
2. Define explicit defaults in one `defaultState` object.
3. Parse unknown values with coercion + fallback to defaults.
4. Serialize only non-default values to keep URLs compact.
5. Reset page to 1 when non-page filters change.
6. Preserve unrelated state when editing one key (no accidental drops).

## Recommended Shape

```ts
export type ListState = {
  q: string;
  sort: "created" | "title";
  sortDesc: boolean;
  page: number;
};

export const defaultState: ListState = {
  q: "",
  sort: "created",
  sortDesc: true,
  page: 1,
};
```

## Parse Rules

- Treat malformed numeric params as default.
- Treat malformed enums as default.
- Parse booleans only from strict allowlist (`"true"`, `"1"`, `"yes"`).
- Never throw for query parsing.

## Serialization Rules

- Omit defaults.
- Keep ordering deterministic for stable links.
- Build URLs via helpers, not ad-hoc string concatenation in components.

## Pattern Sources

- Query key/default/parse/serialize helpers:
  `cloud/packages/apps/src/spaces/frontend/[id]/_components/filter/types.ts`
- URL-driven pagination + preserved filter links:
  `cloud/packages/apps/src/spaces/frontend/[id]/page.tsx`
