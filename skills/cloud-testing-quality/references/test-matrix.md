# Test Matrix

## Mandatory Static Gates

1. `bun run check:skills`
2. `bun run check:boundaries`
3. `bun run check:cycles`
4. `bun run check:service-api-contracts`
5. `bun run typecheck`

## Build Gate

- `bun run build`

## Manual Smoke Scope (Minimal, High Signal)

- changed API endpoints: one success + one expected error path
- changed SSR pages: load + deep link + role-based visibility
- changed islands: primary interaction + keyboard/focus behavior
- changed ACL paths: role gate + ACL gate + guard edges

## Suggested Feature-Specific Smokes

- Files-like flows:
  - list, select, detail open/close
  - upload or move/delete path if touched
- Notebooks-like flows:
  - create/edit mutation
  - settings save/delete + permissions path if touched
- Spaces-like flows:
  - item create/update and detail panel mutation
  - settings/permission updates when touched

## Query-State Heavy Screens

- query parse/serialize round-trip keeps values stable
- default values are omitted from URL
- changing filters resets page to 1
- count/list totals stay aligned for same filter set
- deep-link + back/forward restore selected detail state

## Reporting Format

- What was validated
- What could not be validated
- Residual risk (if any)
