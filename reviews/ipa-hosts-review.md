# IPA Hosts App — Code Review

**Reviewer:** Claude (automated static review)
**Date:** 2026-03-08
**Scope:** `packages/apps/src/ipa-hosts` + `packages/core/src/services/ipa-hosts` + integration points

---

# Executive Summary

The `ipa-hosts` app is a well-structured standalone admin domain for managing FreeIPA hosts and hostgroups with a local PostgreSQL mirror. The architecture correctly follows the cloud app conventions: clean facade, thin API layer, separate service, app-local contracts, and proper lifecycle hooks.

However, the review uncovered **one critical bug** (partial updates null out unmodified fields), several medium-severity issues around cron validation, sync performance, and missing settings registration, and a handful of low-severity code quality items.

The FreeIPA-first mutation invariant is correctly preserved in all mutation paths. Auth is properly gated. The frontend is clear about FreeIPA being the source of truth.

**Summary counts:**
- Critical: 1
- High: 2
- Medium: 5
- Low: 5

---

# Findings (Ordered by Severity)

## Critical

### C1. `hostMod` partial update nulls out unmodified fields

**File:** `packages/core/src/services/ipa-hosts/provider.ts:119-125`

The SQL UPDATE in `hostMod` unconditionally sets all three fields:

```ts
await sql`
  UPDATE ipa_hosts.hosts
  SET description = ${opts.description ?? null},
      location = ${opts.location ?? null},
      locality = ${opts.locality ?? null}
  WHERE fqdn = ${fqdn}
`;
```

When only one field is provided (e.g. `{ description: "new" }`), the other two fields (`location`, `locality`) are `undefined`, and `undefined ?? null` evaluates to `null`. This **silently erases** existing values for fields that were not modified.

The IPA call correctly skips unset fields (lines 108-111 only build `ipaOpts` for defined keys), so FreeIPA stays correct, but the local mirror diverges — it loses data that FreeIPA still has.

**Impact:** Every partial host edit corrupts the local mirror until the next sync. Users will see fields disappear after editing a single field.

**Recommendation:** Build the SQL SET clause dynamically, only including fields that were actually provided:

```ts
const updates: Record<string, unknown> = {};
if (opts.description !== undefined) updates.description = opts.description;
if (opts.location !== undefined) updates.location = opts.location;
if (opts.locality !== undefined) updates.locality = opts.locality;
// Then build SQL with only the present keys, or re-fetch from IPA response
```

Alternatively, read the updated record from the IPA response (`response.result.result`) and mirror the canonical values.

---

## High

### H1. No cron expression validation on `updateSyncCron`

**File:** `packages/core/src/services/ipa-hosts/sync.ts:272-281`

The `updateSyncCron` method only checks for empty strings:

```ts
const normalized = cron.trim();
if (!normalized) throw new Error("Sync cron must not be empty.");
```

An invalid cron expression (e.g. `"banana"`, `"* * * *"` with 4 fields) will be saved to the settings DB and passed to `syncScheduler.register()`. Depending on how `@valentinkolb/sync` handles invalid cron, this could:
- Silently never fire
- Throw at registration and break the scheduler
- Crash on the next startup

**Impact:** An admin could accidentally break automated host syncing with no immediate feedback.

**Recommendation:** Add cron validation before saving. Use a lightweight cron parser (e.g. `cron-parser` or the sync library's own validation) to reject malformed expressions early with a clear error message.

---

### H2. `hostgroupMod` has the same partial-update null-out bug

**File:** `packages/core/src/services/ipa-hosts/provider.ts:283-287`

```ts
await sql`
  UPDATE ipa_hosts.hostgroups
  SET description = ${opts.description ?? null}, synced_at = now()
  WHERE cn = ${cn}
`;
```

Currently `UpdateHostgroupSchema` only has `description`, so the bug is less impactful — but the pattern is wrong. If `opts.description` is `undefined` (no fields provided), the early return on line 276 prevents this path. However, if the schema is extended later (e.g. adding more fields), this same pattern will cause data loss.

**Impact:** Low risk today (only one field), but the pattern should match `hostMod` fix to prevent future regressions.

**Recommendation:** Apply the same dynamic-SET fix as recommended for `hostMod`.

---

## Medium

### M1. `ipa-hosts.sync_cron` not registered in central settings registry

**File:** `packages/core/src/services/settings/defaults.ts` (missing entry)
**Related:** `packages/core/src/services/ipa-hosts/sync.ts:13`

The setting key `ipa-hosts.sync_cron` is used via `settings.get(SYNC_CRON_KEY)` and `settings.set(SYNC_CRON_KEY, ...)`, but it is never registered via `registerSettings()`. This means:

1. The setting won't appear in the admin settings UI for documentation
2. No default value is officially declared in the registry
3. The group label for `ipa-hosts` is not registered

**Impact:** Admin operators have no visibility into this setting from the general settings page. The hardcoded default in sync.ts works, but the setting is invisible.

**Recommendation:** In the app's `index.ts` setup lifecycle or at module scope, call:
```ts
registerSettings([{
  key: "ipa-hosts.sync_cron",
  type: "string",
  default: "*/5 * * * *",
  description: "Five-field cron schedule for IPA host sync in app.timezone",
  group: "ipa-hosts",
}]);
registerGroupLabel("ipa-hosts", "IPA Hosts");
```

Or keep it intentionally unregistered if the goal is to manage it exclusively via the app's own Settings dialog. In that case, add a comment in the code explaining this intentional choice.

---

### M2. Sync inserts hosts/hostgroups one-by-one in a loop

**File:** `packages/core/src/services/ipa-hosts/sync.ts:125-143` (hosts), `150-157` (hostgroups), `168-178` (host_hostgroups), `180-189` (hostgroup_hostgroups)

The sync transaction issues individual INSERT statements inside `for` loops. For a fleet of 500+ hosts across 50+ hostgroups, this generates hundreds of sequential SQL round-trips within a single transaction.

```ts
for (const host of hosts) {
  await tx`INSERT INTO ipa_hosts.hosts ...`;
}
```

**Impact:** Sync duration scales linearly with host count. Transaction holds a connection for the entire duration, increasing risk of connection pool exhaustion under load.

**Recommendation:** Batch inserts using `sql(values)` array syntax or a multi-row VALUES clause. The junction table inserts (host_hostgroups, hostgroup_hostgroups) are the most numerous and would benefit most from batching.

---

### M3. Page.tsx N+1 query pattern and unbounded data fetch

**File:** `packages/apps/src/ipa-hosts/frontend/page.tsx:14-28`

```ts
const hostgroupsPage = await ipaHostsService.hostgroup.list({
  pagination: { perPage: 9999 },
  ...
});
const hostsPerGroup = await Promise.all(
  hostgroups.map((hg) => ipaHostsService.host.listByGroup({ ... })),
);
```

Two issues:
1. **N+1 pattern**: For N hostgroups, this issues N+1 database queries (1 list + N per-group queries)
2. **`perPage: 9999`**: Effectively unbounded. Works for small fleets, but with 100+ hostgroups or 1000+ hosts, this causes excessive memory use and slow SSR rendering

**Impact:** SSR latency grows linearly with hostgroup count. Could cause timeouts for large deployments.

**Recommendation:**
- Consider a single SQL query that joins hosts with their hostgroups and groups results in application code
- Add real pagination to the admin page (or at minimum a reasonable cap with a warning)

---

### M4. API host list endpoint uses `perPage: 9999`

**File:** `packages/apps/src/ipa-hosts/api.ts:72`

```ts
const hostsPage = await ipaHostsService.host.list({ pagination: { perPage: 9999 } });
```

The `GET /api/ipa-hosts/` endpoint fetches up to 9999 hosts with no pagination support exposed to the client.

**Impact:** For large host fleets, response size and query time could be problematic. The endpoint also doesn't accept pagination query parameters.

**Recommendation:** Either:
- Add pagination query params (like the hostgroups endpoint)
- Or document this as an intentional "list all" endpoint with a comment explaining why

---

### M5. Sync success does not refresh the page

**File:** `packages/apps/src/ipa-hosts/frontend/SyncHosts.island.tsx:14-17`

After sync completes, the UI shows an alert but does not call `refreshCurrentPath()`:

```ts
onSuccess: () =>
  prompts.alert("Host sync started. ...", { ... }),
```

The sync is asynchronous (job-based), so the page won't reflect new data until the user manually refreshes.

**Impact:** User confusion — they click "Sync now", see a success message, but stale data remains on screen.

**Recommendation:** Either:
- Add a note in the alert: "Refresh the page after a few seconds to see updated data."
- Or add a delayed `refreshCurrentPath()` after the alert is dismissed

---

## Low

### L1. `hostgroupAdd` uses truthy check instead of `!== undefined`

**File:** `packages/core/src/services/ipa-hosts/provider.ts:257`

```ts
if (opts?.description) ipaOpts.description = opts.description;
```

An empty string `""` is falsy, so `description: ""` would be silently dropped. The IPA call would not clear an existing description. Contrast with `hostgroupMod` (line 275) which correctly uses `!== undefined`.

**Impact:** Minor — creating a hostgroup with `description: ""` is unusual. But inconsistent with the `Mod` variant.

**Recommendation:** Change to `if (opts?.description !== undefined)`.

---

### L2. Coupling to `../ipa/lib` from ipa-hosts service

**File:** `packages/core/src/services/ipa-hosts/provider.ts:2`
**File:** `packages/core/src/services/ipa-hosts/sync.ts:6-7`

The ipa-hosts domain imports `call`, `str`, `escapeLike`, `toPgTextArray`, `excludedGroupsSet`, `mapIpaErrorCode`, `DbRow` from `../ipa/lib`, and `getServiceSession` from `../ipa/auth`.

While these are shared IPA infrastructure utilities, the import path creates a structural coupling to the user/identity IPA domain's internal module.

**Impact:** Not a bug, but if the `ipa` module is ever refactored or split, these imports break. The coupling is defensible since both domains share the same FreeIPA server.

**Recommendation:** Consider extracting the shared IPA RPC utilities (`call`, `str`, `baseUrl`, etc.) into a standalone `services/ipa-rpc` or `services/ipa/shared` module. This would make the boundary explicit. Low priority — current structure works fine.

---

### L3. `respondMessage` helper swallows result data

**File:** `packages/apps/src/ipa-hosts/api.ts:35-50`

```ts
const respondMessage = async (c, resultPromise, message, successStatus = 200) => {
  return respond(c, async () => {
    const result = await resultPromise;
    if (result && typeof result === "object" && "ok" in result && !result.ok) return result;
    return ok({ message });
  }, successStatus);
};
```

The success path discards the actual result and returns a fixed message. This is fine for mutations where the client doesn't need return data, but the error path's duck-typing (`"ok" in result`) is fragile.

**Impact:** Works for current usage. Could mask issues if a service method returns an unexpected shape.

**Recommendation:** Use the `IpaMutationResult` type from the service layer for the type check instead of duck-typing.

---

### L4. `excludedGroupsSet` filters hostgroups during sync but not in queries

**File:** `packages/core/src/services/ipa-hosts/sync.ts:53,64`

During sync, excluded groups are filtered from `memberofHostgroup` and hostgroup children. But the `hostgroupList`, `hostgroupSearch`, and `hostgroupGet` queries in `provider.ts` don't filter excluded groups — they return whatever is in the local DB.

**Impact:** Since excluded groups are filtered during sync (they never enter the DB), this is technically consistent. But if an excluded group is added to the DB via the `hostgroupAdd` mutation, it would appear in listings.

**Recommendation:** Document this assumption clearly: excluded groups are filtered at sync-time ingest, not at query-time.

---

### L5. Module-level mutable state in sync runtime

**File:** `packages/core/src/services/ipa-hosts/sync.ts:228-230`

```ts
let started = false;
let registered = false;
let registerPromise: Promise<void> | null = null;
```

Module-level mutable state for lifecycle management. This follows the same pattern as other services in the codebase, so it's consistent. However, `stop()` resets `registered = false` and `registerPromise = null` which could race with a concurrent `ensureRegistered()`.

**Impact:** Unlikely in practice since `start()`/`stop()` are called from lifecycle hooks, not concurrently.

**Recommendation:** No action needed if lifecycle hooks are guaranteed sequential. Add a comment noting this assumption.

---

# Correctness Risks

| # | Risk | Severity | Status |
|---|------|----------|--------|
| 1 | `hostMod` partial update nulls unmodified fields | Critical | **Open — must fix** |
| 2 | `hostgroupMod` same pattern (less impactful today) | High | Open |
| 3 | `hostgroupAdd` truthy check drops empty description | Low | Open |
| 4 | `respondMessage` duck-typing fragile | Low | Acceptable |

The FreeIPA-first mutation invariant is **correctly preserved** in all mutation paths:
- `hostMod`, `hostDel`, `hostAddToGroup`, `hostRemoveFromGroup` all call IPA first, check for errors, and only update the local DB on success.
- `hostgroupAdd`, `hostgroupMod`, `hostgroupDel` follow the same pattern.
- The local mirror cannot become *more* permissive than IPA (no optimistic writes).
- In a failure where IPA succeeds but the local DB update fails, the mirror will be stale-behind (not stale-ahead), and the next sync will correct it.

---

# Security Risks

The security posture is **solid**:

1. **Auth is properly enforced:**
   - API routes: `auth.requireRole("admin")` middleware at line `api.ts:60`
   - Page routes: `auth.requireRole("admin", auth.redirectToLogin)` at `pages.ts:5`
   - IPA session: `requireIpaSession()` check on all mutation endpoints

2. **No injection risks found:**
   - All SQL uses parameterized queries via `bun:sql` tagged templates
   - `escapeLike()` properly escapes LIKE wildcards
   - URL parameters are not interpolated into SQL

3. **No privilege escalation vectors:**
   - All endpoints are admin-only
   - No user-facing data exposure beyond admin pages
   - Hostgroup search exclude list comes from query params but is only used in SQL `<> ALL(...)` with parameterized values

4. **Rate limiting is applied** via `rateLimit()` middleware.

5. **Minor concern:** The `fqdn` and `cn` URL parameters (`:fqdn`, `:cn`) are not validated for format before being passed to IPA RPC calls. FreeIPA itself will reject invalid values, so this is defense-in-depth rather than a real gap. Consider adding a basic regex validation (e.g., no whitespace, reasonable length) as hardening.

---

# Stability / Operational Risks

1. **Sync is transactional and safe:** The full sync runs in a single `sql.begin()` transaction, so a failure mid-sync rolls back cleanly.

2. **Empty-data safety check is good:** Lines `sync.ts:114-119` refuse to sync when remote data is empty but local mirror has data. This prevents accidental wipe from IPA outages.

3. **Sync logging is adequate:** `syncLog.info("Sync complete", summary)` captures all relevant metrics.

4. **Job/scheduler setup follows conventions:** `maxAttempts: 3`, `leaseMs: 180_000`, `misfire: "skip"` are all reasonable defaults.

5. **Service session handling is correct:** Uses `getServiceSession()` from `ipa/auth.ts` which caches and refreshes sessions.

6. **Risk: No cron validation** (see H1) could leave sync permanently broken with no error surfaced to the admin.

7. **Risk: TRUNCATE in sync transaction** (`sync.ts:166`) is aggressive but correct — it's inside a transaction and immediately re-populated. If the transaction rolls back, the truncated data is restored.

---

# Maintainability / KISS / DRY Findings

1. **App is genuinely self-contained:**
   - Own contracts, schemas, types, migrations, service, API, frontend
   - Only shared dependencies are IPA RPC utilities (`ipa/lib`, `ipa/auth`) and settings service
   - No hidden coupling to user/group sync domain

2. **Types are app-locally owned:**
   - `contracts.ts` defines all API schemas
   - `provider.ts` defines `IpaHostRecord`, `IpaHostgroupRecord`, `IpaHostsMutationResult`
   - No dependency on `@valentinkolb/cloud-contracts` for domain types

3. **Code is clean and follows conventions:**
   - Consistent with cloud-app-builder patterns
   - Service layer is a thin wrapper around core service
   - API layer is a thin wrapper around service

4. **Minor DRY opportunity:** The `toLike()` helper and pagination defaults (`page ?? 1`, `perPage ?? 20`) are duplicated across `hostList`, `hostgroupList`, `hostListByGroup`. These are small enough that extraction isn't necessary, but could reduce repetition.

5. **No dead code found.** All exports are consumed. No TODO/FIXME/HACK comments.

6. **No leftover host logic in the IPA user domain.** The `ipa/index.ts` exports do not include host-related functions. The `ipa/sync.ts` handles only users/groups.

---

# UI / Admin UX Findings

1. **Source-of-truth messaging is clear:**
   - Info block on page.tsx: "FreeIPA is the source of truth for hosts and hostgroups. Local data is only a mirror."
   - Empty state message: "No mirrored hostgroups yet. Run a sync to load data from FreeIPA."
   - Sync confirmation dialog explains the behavior

2. **Dangerous actions have confirmation dialogs:**
   - Delete host: "Are you sure? This cannot be undone."
   - Delete hostgroup: Same pattern
   - Remove from group: Confirmation with danger variant

3. **Settings modal is functional but could be more descriptive:**
   - Shows cron input but doesn't explain cron syntax
   - No preview of "next run time"
   - No mention of timezone (the scheduler uses `app.timezone` but this isn't communicated to the admin)

4. **Sync button feedback gap (M5):** Success alert says "sync started" but page doesn't refresh, leaving stale data visible.

5. **Hostgroup card design is clear:** Shows host count, nested hostgroups as badges, inline host table with copy buttons.

---

# Open Questions

1. **Is `ipa-hosts` truly self-contained?**
   Yes. The only external dependencies are IPA RPC utilities (shared infrastructure) and the settings service. No coupling to user/group domain logic.

2. **Are app-local types/schemas/contracts correctly owned?**
   Yes. `contracts.ts` owns all API schemas. `provider.ts` owns domain types. No dependency on shared contracts for domain types.

3. **Is the FreeIPA-first mutation invariant preserved?**
   Yes, in all 7 mutation paths (hostMod, hostDel, hostAddToGroup, hostRemoveFromGroup, hostgroupAdd, hostgroupMod, hostgroupDel).

4. **Can the local mirror become inconsistent?**
   Yes, via the `hostMod` partial-update bug (C1). Also, if the local DB write fails after IPA succeeds, the mirror will be stale-behind until the next sync (acceptable).

5. **Is the sync operationally robust?**
   Yes, with caveats: transactional, has empty-data safety, good logging. But lacks cron validation (H1) and could be slow for large fleets (M2).

6. **Are there leftover host code paths in the IPA user domain?**
   No. Clean separation confirmed.

7. **Is the app-local sync-cron settings flow clean?**
   Mostly. Works correctly but lacks cron validation (H1) and settings registry integration (M1).

8. **Are there security or privilege-check regressions?**
   No. Auth is correctly enforced at both API and page levels.

9. **Are there SQL-first violations?**
   No. All filtering, pagination, and aggregation happens in SQL. Search uses SQL LIKE with proper escaping.

10. **Are there dead or transitional artifacts?**
    No. The codebase is clean with no dead code, TODOs, or transitional shims.
