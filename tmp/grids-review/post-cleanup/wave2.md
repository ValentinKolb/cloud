# Wave 2 (Permissions) — Post-Cleanup Review

**Commits reviewed:** 66e0045, 58da2d6, bf10c11
**Files changed:** 6

## Verdict
Wave 2 closes the targeted permission-critical paths for deny-overrides, dashboard resolver coverage, direct GET `none` bypasses, audit scoping, and personal-to-shared promotion. The implementation is mostly coherent: one central resolver now understands dashboard targets, direct GET routes use resource-scoped resolution, and dashboard PATCH/DELETE/RESTORE follow the locked base-admin write rule. One locked-rule gap remains: personal dashboard creation still only requires base-read, so the write policy is not applied consistently.

## Closed findings
- **Permission resolver does not implement deny-overrides — closed.** The resolver now carries principal tiers (`packages/grids/src/service/permission-resolver.ts:24`, `packages/grids/src/service/permission-resolver.ts:29`), walks user/group/auth/public specificity (`packages/grids/src/service/permission-resolver.ts:40`, `packages/grids/src/service/permission-resolver.ts:55`), and returns `none` when any grant in the winning tier denies (`packages/grids/src/service/permission-resolver.ts:59`). Resource specificity still wins first, falling back dashboard/view/form/table/base in one path (`packages/grids/src/service/permission-resolver.ts:84`, `packages/grids/src/service/permission-resolver.ts:90`, `packages/grids/src/service/permission-resolver.ts:102`, `packages/grids/src/service/permission-resolver.ts:106`).
- **Dashboard ACLs are outside the central permission resolver — closed enough for the critical.** Dashboard is now a resolver resource type and target (`packages/grids/src/service/permission-resolver.ts:14`, `packages/grids/src/service/permission-resolver.ts:38`), `loadGrantsForUser` loads `grids.dashboard_access` (`packages/grids/src/service/permission-resolver.ts:152`, `packages/grids/src/service/permission-resolver.ts:210`), and API permission loading passes `dashboardId` through (`packages/grids/src/api/permissions.ts:29`, `packages/grids/src/api/permissions.ts:78`). The list query still keeps its SQL-tier resolver, but it matches the same deny-overrides shape and no longer leaves dashboards unsupported by the central resolver.
- **Record audit can leak across tables — closed.** The API now passes both `tableId` and `recordId` to the audit service (`packages/grids/src/api/records.ts:304`), and `listByRecord` filters on both columns (`packages/grids/src/service/audit.ts:83`, `packages/grids/src/service/audit.ts:95`). A guessed record UUID from another table no longer returns rows under a table the caller can read.
- **Personal views/dashboards can be published without admin permission — closed for update paths.** View PATCH detects personal→shared and shared→personal transitions and gates them at base-admin (`packages/grids/src/api/views.ts:153`, `packages/grids/src/api/views.ts:157`). Dashboard PATCH is stricter: every dashboard update is base-admin regardless of ownership (`packages/grids/src/api/dashboards.ts:152`, `packages/grids/src/api/dashboards.ts:157`).
- **View/dashboard `none` grants are bypassable by direct GET — closed.** View GET resolves at `{ baseId, tableId, viewId }` and returns 404 when the effective level is below read (`packages/grids/src/api/views.ts:105`, `packages/grids/src/api/views.ts:110`); dashboard GET does the same at `{ baseId, dashboardId }` (`packages/grids/src/api/dashboards.ts:114`, `packages/grids/src/api/dashboards.ts:118`). Personal resources also require owner or explicit resource grant after the read gate (`packages/grids/src/api/views.ts:117`, `packages/grids/src/api/views.ts:119`, `packages/grids/src/api/dashboards.ts:125`, `packages/grids/src/api/dashboards.ts:127`).

## New findings
### Critical
none.

### Important
- **Dashboard create still violates the locked write rule** — `packages/grids/src/api/dashboards.ts:72` — the locked rule says dashboard write requires base-admin regardless of ownership, but personal dashboard create still gates only on base-read (`body.shared ? admin : read`). That lets a base-reader create dashboard rows they cannot later edit/delete under the new PATCH/DELETE admin gates. Make dashboard POST require `gateAt(c, { baseId }, "admin")` for both shared and personal dashboards, or explicitly weaken the locked rule to exclude create.

### Minor
- **Dashboard route comment preserves the old rule** — `packages/grids/src/api/dashboards.ts:18` — the header still says personal dashboard owners "can do anything", while PATCH/DELETE/RESTORE correctly require base-admin. Update it with the create fix so the next permissions pass does not reintroduce owner-write.

## KISS / overengineering check
The resolver is a bit branchier than before, but the added structure earns its keep: resource scope and principal tier are now explicit, and the deny-overrides rule is localized in `resolveResourceLevel`. The API layer added `resolveWithGrants` only for direct GET routes that need "effective level plus explicit grant" at the same time; that is reasonable and avoids duplicating grant loading in views/dashboards.

The main simplification left is dashboard write gating: one unconditional admin gate for POST/PATCH/DELETE/RESTORE is simpler than the current create-time shared/personal branch plus admin-only later writes.

## Open follow-ups noticed during review
- Decide whether explicit view/dashboard read grants should allow direct GET without parent list permission. The new direct GET path permits that via resource-scoped resolution, while list routes still first require table/base read (`packages/grids/src/api/views.ts:29`, `packages/grids/src/api/dashboards.ts:41`).
- Dashboard ACL comments in `service/dashboards.ts` still describe owner/base-write edit rights; clean those up with the dashboard create gate so the locked rule has one story.

## Verification
- Ran `bun test packages/grids/src/service/permission-resolver.test.ts`: 20 pass.
