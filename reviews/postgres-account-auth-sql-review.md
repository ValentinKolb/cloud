# PostgreSQL SQL Audit — Account/Auth Migration Regressions

**Date:** 2026-03-12
**Scope:** All SQL construction paths affected by the canonical account/auth refactor
**Method:** Static code analysis only (no execution, no tests)

---

## 1. Executive Summary

The account/auth migration introduced a SQL-first model where session loading, access checks, and app-level permission filtering all depend on correctly constructed PostgreSQL queries. This audit found:

- **1 HIGH** severity finding (unescaped array literals in OAuth client service)
- **5 MEDIUM** severity findings (duplicated/inconsistent SQL array helpers, missing backslash escaping, duplicate session-loading queries)
- **3 LOW** severity findings (defensive coding gaps, ILIKE wildcard leakage, redis.keys scan)

The previously reported production-breaking bugs (`DISTINCT ... ORDER BY`, empty `IN ${sql([])}`, `values.map is not a function`) appear to have been **fixed** in the current codebase. All `IN ${sql(...)}` / `NOT IN ${sql(...)}` call sites now have proper empty-array guards (early returns or ternary fallbacks). The `SELECT DISTINCT ... ORDER BY` queries all include the ORDER BY column in the select list. The `toPgUuidArray`/`toPgTextArray` helpers that are called from access-sensitive paths have `Array.isArray` guards.

However, the fixes were applied inconsistently — the codebase now has **5 duplicate definitions of `toPgUuidArray`** and **3 duplicate definitions of `toPgTextArray`** with divergent escaping and null-handling behavior. One app (OAuth) bypasses these helpers entirely and uses bare `.join(",")` with no escaping at all. These inconsistencies are the primary remaining risk surface.

---

## 2. Review Scope

### Files audited (40+)

**Core account/auth services:**
- `packages/core/src/services/accounts/users.ts`
- `packages/core/src/services/accounts/groups.ts`
- `packages/core/src/services/accounts/local-groups.ts`
- `packages/core/src/services/account-lifecycle/index.ts`
- `packages/core/src/services/account-model.ts`
- `packages/core/src/services/session/index.ts`
- `packages/core/src/services/postgres.ts`
- `packages/core/src/api/auth.ts`
- `packages/core/src/api/me.ts`
- `packages/core/src/api/admin-account-lifecycle.ts`

**IPA integration:**
- `packages/core/src/services/ipa/users.ts`
- `packages/core/src/services/ipa/groups.ts`
- `packages/core/src/services/ipa/search.ts`
- `packages/core/src/services/ipa/sync.ts`
- `packages/core/src/services/ipa/profile.ts`
- `packages/core/src/services/ipa/index.ts`

**Shared infrastructure:**
- `packages/lib/src/server/services/access.ts`
- `packages/lib/src/server/services/freeipa/util.ts`
- `packages/lib/src/server/middleware/auth.ts`

**App services:**
- `packages/apps/src/spaces/service/spaces.ts`
- `packages/apps/src/spaces/service/items.ts`
- `packages/apps/src/spaces/service/access.ts`
- `packages/apps/src/notebooks/service/notebooks.ts`
- `packages/apps/src/notebooks/service/access.ts`
- `packages/apps/src/contacts/service/shared.ts`
- `packages/apps/src/contacts/service/books.ts`
- `packages/apps/src/contacts/service/contacts.ts`
- `packages/apps/src/contacts/service/access.ts`
- `packages/apps/src/accounts/service/groups.ts`
- `packages/apps/src/accounts/service/users.ts`
- `packages/apps/src/accounts/service/index.ts`
- `packages/apps/src/accounts/service/admin.ts`
- `packages/apps/src/oauth/service/clients.ts`
- `packages/apps/src/oauth/service/tokens.ts`
- `packages/apps/src/proxy-auth/service/index.ts`
- `packages/apps/src/files/service/permissions.ts`
- `packages/apps/src/logging/service/index.ts`

### Patterns checked repo-wide

- `SELECT DISTINCT ... ORDER BY ...`
- `IN ${sql(...)}`  /  `NOT IN ${sql(...)}`
- `ANY(${toPgUuidArray(...)})` / `ANY(${toPgTextArray(...)})`
- `.join(",")}}` (bare array literal construction)
- Recursive CTEs with provider-sensitive joins
- `toPgUuidArray` / `toPgTextArray` — all definitions and all call sites
- `memberofGroupIds` / `managesGroupIds` flow from DB to SQL consumers

---

## 3. Findings

### F-01 — OAuth client arrays built with bare `.join(",")` — no escaping

| Field | Value |
|---|---|
| **ID** | F-01 |
| **Severity** | **HIGH** |
| **File** | `packages/apps/src/oauth/service/clients.ts` |
| **Lines** | 95–97 (create), 140–142 (update) |

**Code:**
```typescript
const redirectUrisLiteral = `{${data.redirectUris.join(",")}}`;
const scopesLiteral = `{${data.scopes.join(",")}}`;
const allowedProfilesLiteral = `{${data.allowedProfiles.join(",")}}`;
```

**Impact:** These construct PostgreSQL `text[]` array literals by joining user-provided values with commas and wrapping in `{}`. There is **zero escaping** — no quoting of individual elements, no handling of commas, double-quotes, curly braces, or backslashes.

**Concrete failure scenario:** A redirect URI like `https://example.com/callback?a=1,b=2` produces the literal `{https://example.com/callback?a=1,b=2}` which PostgreSQL parses as **two separate elements**: `https://example.com/callback?a=1` and `b=2`. This is silent data corruption. A URI containing `"` or `}` would cause a PostgreSQL parse error.

**Why this matters now:** While this code may predate the account/auth refactor, the refactor made OAuth client management accessible through new admin routes that depend on the canonical session model. Any OAuth client with commas in redirect URIs will be silently corrupted on save.

---

### F-02 — Five duplicate `toPgUuidArray` definitions with inconsistent escaping

| Field | Value |
|---|---|
| **ID** | F-02 |
| **Severity** | **MEDIUM** |
| **Files** | See table below |

| # | File | Line | Has null guard? | Escapes backslashes? |
|---|------|------|-----------------|---------------------|
| 1 | `packages/lib/src/server/services/access.ts` | 58–61 | Yes (`Array.isArray`) | **No** |
| 2 | `packages/apps/src/contacts/service/shared.ts` | 17–19 | Yes (`Array.isArray`) | **No** |
| 3 | `packages/apps/src/spaces/service/spaces.ts` | 10–13 | Yes (`Array.isArray`) | **No** |
| 4 | `packages/apps/src/spaces/service/items.ts` | 747–749 | Yes (`Array.isArray`) | **No** |
| 5 | `packages/apps/src/notebooks/service/notebooks.ts` | 60–63 | Yes (`Array.isArray`) | **No** |

**Impact:** All five implementations only escape double-quotes, not backslashes. For UUID values (hex + dashes) this is safe today. But the identical function name and signature across five files invites copy-paste reuse for non-UUID text values, where the missing backslash escaping would produce malformed PostgreSQL array literals.

**Recommendation:** Consolidate into a single shared helper. Since inputs are always UUIDs from the database, practical risk is low but the maintenance hazard is real.

---

### F-03 — Three duplicate `toPgTextArray` definitions with divergent safety

| Field | Value |
|---|---|
| **ID** | F-03 |
| **Severity** | **MEDIUM** |
| **Files** | See table below |

| # | File | Line | Has null guard? | Escapes backslashes? |
|---|------|------|-----------------|---------------------|
| 1 | `packages/core/src/services/postgres.ts` | 2–3 | **No** (requires `string[]`) | Yes |
| 2 | `packages/lib/src/server/services/freeipa/util.ts` | 63–64 | **No** (requires `string[]`) | Yes |
| 3 | `packages/apps/src/contacts/service/shared.ts` | 9–11 | Yes (`Array.isArray`) | **No** |

**Impact:** The contacts version (#3) handles `null`/`undefined` safely but fails to escape backslashes. The core/freeipa versions (#1, #2) escape backslashes correctly but will throw `Cannot read properties of undefined (reading 'map')` if called with `undefined`.

A developer importing the wrong version gets subtly different safety guarantees:
- Import from `contacts/shared.ts` → safe for nulls, unsafe for backslash-containing text
- Import from `postgres.ts` → safe for backslashes, crashes on nulls

**Concrete risk for contacts:** If a contact field value ever contains a backslash (e.g., `O'Brien\Jr`), `toPgTextArray` from `shared.ts` would produce a malformed array literal.

---

### F-04 — Duplicate session-user loading queries across accounts/ and ipa/

| Field | Value |
|---|---|
| **ID** | F-04 |
| **Severity** | **MEDIUM** |
| **File** | `packages/core/src/services/accounts/users.ts` (lines 220–264) and `packages/core/src/services/ipa/users.ts` (lines 77–122) |

**Impact:** Two near-identical complex SQL queries (each with 4 correlated array subqueries, 2 recursive CTEs) implement session user loading. The `accounts/users.ts` version is the canonical path; `ipa/users.ts` is the legacy path. Both are called from `loadSessionUser` in the auth middleware (`packages/lib/src/server/middleware/auth.ts` line 51).

Any bug fix applied to one **must be manually replicated** in the other. This is how the original `DISTINCT ... ORDER BY` bug likely appeared — a fix in one file but not the other.

The recursive CTEs use `UNION` (not `UNION ALL`), which prevents infinite loops but means duplicate elimination happens implicitly. If the CTE structure is ever modified without understanding this, `UNION ALL` could cause explosive row multiplication.

---

### F-05 — `toPgTextArray` from `postgres.ts` / `freeipa/util.ts` has no null/undefined guard

| Field | Value |
|---|---|
| **ID** | F-05 |
| **Severity** | **MEDIUM** |
| **Files** | `packages/core/src/services/postgres.ts:2`, `packages/lib/src/server/services/freeipa/util.ts:63` |

**Code:**
```typescript
export const toPgTextArray = (values: string[]): string =>
  `{${values.map(...)}}`;
```

**Impact:** TypeScript signature says `string[]` but provides no runtime guard. Current callers in `ipa/sync.ts` and `ipa/users.ts` protect against this with upstream `Array.isArray` checks and `?? []` fallbacks. However, if any future caller passes `undefined` (e.g., due to a new IPA response shape or a missing field after schema migration), this will throw at runtime on the hot session-loading path.

**Call sites relying on upstream guards:**
- `ipa/sync.ts` lines 244, 245, 282, 283, 325, 327, 621, 622 — guarded by `transformSyncUser` which does `Array.isArray(raw.ipasshpubkey) ? raw.ipasshpubkey : []`
- `ipa/users.ts` lines 771–772 — guarded by explicit `Array.isArray(result?.ipasshpubkey) ? ... : []`

---

### F-06 — Four recursive CTE subqueries on every authenticated request

| Field | Value |
|---|---|
| **ID** | F-06 |
| **Severity** | **LOW** (performance, not correctness) |
| **Files** | `packages/core/src/services/accounts/users.ts:220–264`, `packages/core/src/services/ipa/users.ts:77–122` |

**Impact:** Every authenticated request runs the session-user query which embeds 4 correlated array subqueries (2 with recursive CTEs). The same `user_all_groups` CTE is materialized **twice** — once for `manages` (group names) and once for `manages_group_ids` (group UUIDs). The two `manages`-related subqueries each use LEFT JOINs on both `group_manager_users_v2` and `group_manager_groups_v2`, which can produce a cross-product before `DISTINCT` collapses it.

Not a correctness bug, but a latent performance issue on the critical auth path.

---

### F-07 — Logging search ILIKE does not escape `%` / `_` wildcards

| Field | Value |
|---|---|
| **ID** | F-07 |
| **Severity** | **LOW** |
| **File** | `packages/core/src/services/logging/index.ts:132` |

**Code:**
```typescript
const searchPattern = search ? `%${search}%` : null;
```

**Impact:** User-supplied `search` is embedded in an ILIKE pattern without escaping `%` and `_` metacharacters. A search for `100%` would match any string containing `100` followed by anything. Not SQL injection (value is parameterized), but allows unintended pattern matching. Minor information disclosure risk.

---

### F-08 — `redis.keys()` pattern scan in session cleanup

| Field | Value |
|---|---|
| **ID** | F-08 |
| **Severity** | **LOW** (operational, not SQL) |
| **File** | `packages/core/src/services/session/index.ts:84` |

**Code:**
```typescript
const keys = await redis.keys(`session:${userId}:*`);
if (keys.length > 0) await redis.del(...keys);
```

**Impact:** `redis.keys()` performs an O(N) scan across all keys. Called from account deletion, provider switch, and demotion flows. With many concurrent sessions, this blocks the Redis event loop. Should use `SCAN` instead.

---

### F-09 — `IN ${sql(...)}` / `NOT IN ${sql(...)}` — all sites properly guarded ✓

| Field | Value |
|---|---|
| **ID** | F-09 |
| **Severity** | **NONE** (verification) |

All `IN ${sql(array)}` and `NOT IN ${sql(array)}` call sites were checked. Every one uses either:
- An early return when the array is empty (e.g., `if (uids.length === 0) return { users: [], total: 0 }`)
- A ternary guard (e.g., `ids.length === 0 ? sql\`TRUE\` : sql\`g.id IN ${sql(ids)}\``)
- A length check before pushing to a conditions array (e.g., `if (excludeIds.length > 0) conditions.push(...)`)

**Verified in:**
- `packages/core/src/services/accounts/users.ts` (lines 294–310)
- `packages/core/src/services/accounts/groups.ts` (lines 95, 104, 108, 110, 182–195)
- `packages/core/src/services/ipa/users.ts` (lines 169–187)
- `packages/core/src/services/ipa/groups.ts` (lines 80–89)
- `packages/core/src/services/ipa/search.ts` (lines 46, 55, 98, 99)
- `packages/core/src/services/ipa/sync.ts` (line 448–453)
- `packages/apps/src/spaces/service/items.ts` (lines 127–133)
- `packages/apps/src/ipa-hosts/backend/sync.ts` (lines 148, 164)

---

### F-10 — `SELECT DISTINCT ... ORDER BY` — all sites correct ✓

| Field | Value |
|---|---|
| **ID** | F-10 |
| **Severity** | **NONE** (verification) |

All `SELECT DISTINCT ... ORDER BY` queries were checked. In every case, the ORDER BY column appears in the SELECT list:

- `accounts/users.ts` lines 233–239: `SELECT DISTINCT g.name ... ORDER BY g.name` ✓
- `ipa/users.ts` lines 90–96: same pattern ✓
- `contacts/books.ts` lines 41–52: `SELECT DISTINCT b.id, b.name ... ORDER BY b.name` ✓
- `contacts/contacts.ts` lines 403–430: `LOWER(c.display_name) AS sort_name ... ORDER BY sort_name` ✓
- `spaces/spaces.ts` lines 121–133: `SELECT DISTINCT s.id, s.name ... ORDER BY s.name` ✓

---

### F-11 — `toPgUuidArray` / `ANY()` with empty arrays — correct ✓

| Field | Value |
|---|---|
| **ID** | F-11 |
| **Severity** | **NONE** (verification) |

When groups is empty, `toPgUuidArray([])` returns `"{}"`, and `group_id = ANY('{}'::uuid[])` evaluates to `FALSE` for every row. This is semantically correct (no groups → no group-based access). Verified in spaces, notebooks, contacts, and the shared access service.

---

## 4. Open Questions / Assumptions

1. **Bun `sql` tagged template empty fragment behavior:** Several dynamic SQL builders use `sql\`\`` (empty template) as a no-op condition fragment (e.g., `spaces/service/items.ts:822`). This works if Bun's sql driver treats empty fragments as zero-length SQL. If it produces whitespace or a semicolon, it could create syntax errors. Assumed safe based on common sql-template-tag behavior, but not verified at runtime.

2. **OAuth client redirect URI validation:** It's unclear whether the OAuth contract/API layer validates redirect URIs before they reach `clients.ts`. If the Zod schema or API handler rejects URIs with commas, the F-01 bug would be unreachable in practice. However, the SQL-level code is still incorrect and should not depend on upstream validation for correctness.

3. **Provider routing:** The auth middleware dispatches to either `accounts/users.get()` or `ipa/users.get()` based on provider configuration. It's assumed both paths are exercised in production. If only one path is active, F-04 (duplicate queries) has lower blast radius but the same maintenance risk.

4. **`memberofGroupIds` nullability:** The session user's `memberofGroupIds` is populated as `(row.member_group_ids as string[]) ?? []`. If the PostgreSQL `COALESCE(ARRAY(...), '{}')` in the session query ever returns `NULL` (which shouldn't happen due to `COALESCE`), the `?? []` fallback catches it. This two-layer defense appears robust.

---

## 5. Overall Verdict

**The previously observed production-breaking regressions (DISTINCT/ORDER BY, empty IN clauses, undefined .map crashes) have been addressed** in the current codebase. The guards are correct and consistently applied across all `IN ${sql(...)}` and `NOT IN ${sql(...)}` call sites.

**The primary remaining risks are:**

| Priority | Finding | Action needed |
|----------|---------|---------------|
| **Fix now** | F-01: OAuth bare `.join(",")` array literals | Use a proper `toPgTextArray` helper with quoting and escaping |
| **Fix soon** | F-02/F-03: 8 duplicate array helpers with divergent safety | Consolidate into a single shared helper with null guard + backslash escaping |
| **Fix soon** | F-04: Duplicate session-loading SQL | Extract shared query builder or deduplicate |
| **Track** | F-05: `toPgTextArray` null crash potential | Add runtime `Array.isArray` guard to `postgres.ts` and `freeipa/util.ts` versions |
| **Track** | F-06/F-08: Performance on hot paths | Consider caching session user; replace `redis.keys` with `SCAN` |
