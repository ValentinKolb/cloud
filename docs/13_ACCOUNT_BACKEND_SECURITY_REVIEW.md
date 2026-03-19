# Unified Account Backend Security Review

## Executive Summary

The unified account backend was reviewed from a security perspective after the migration.

Result:

- no open critical or high-severity security findings remain in the changed account backend surface
- one authorization regression was identified during review and fixed before closing the review
- several medium-severity correctness findings from the follow-up review were also fixed
- provider-aware validation, remote-first IPA mutation ordering, row-preserving provider switches, and canonical expiry handling are all in place

## Scope

Reviewed areas:

- unified user service
- unified groups service
- local provider implementation
- IPA sync updates
- lifecycle and reminder changes
- accounts API routes
- account-related frontend callers where they affected security-sensitive behavior

Primary files reviewed:

- `packages/core/src/services/accounts/users.ts`
- `packages/core/src/services/accounts/groups.ts`
- `packages/core/src/services/providers/local/users.ts`
- `packages/core/src/services/ipa/users.ts`
- `packages/core/src/services/ipa/sync.ts`
- `packages/core/src/services/account-lifecycle/index.ts`
- `packages/apps/src/accounts/api/users.ts`
- `packages/apps/src/accounts/api/groups.ts`

API topology after the hard cut:

- `/api/auth` -> authentication/session only
- `/api/accounts/*` -> account/group/request management
- `/api/accounts/me` -> self-service account actions

## Findings

### Resolved During Review

#### SEC-1: Local group membership mutation lacked local authorization enforcement

Impact:

Any authenticated caller who passed the broad route guard could previously mutate members of local groups without a local manager/admin check.

Remediation:

- added an explicit server-side authorization check for local group membership writes in `packages/apps/src/accounts/api/groups.ts:29-47`
- enforced the check before `POST /groups/:id/members` and `DELETE /groups/:id/members` in `packages/apps/src/accounts/api/groups.ts:154-172` and `packages/apps/src/accounts/api/groups.ts:191-209`
- admins are allowed
- local group managers are allowed
- IPA-backed group mutations still rely on FreeIPA enforcement

Status:

- fixed

#### SEC-2: IPA to local provider switch did not revoke app sessions

Impact:

An account could keep an application session after losing IPA-backed capabilities.

Remediation:

- added session revocation after the `ipa -> local` provider switch path in `packages/core/src/services/accounts/users.ts`

Status:

- fixed

#### SEC-3: Admin demotion used a non-atomic two-step composition

Impact:

A partial failure could leave the account in an inconsistent post-IPA local state.

Remediation:

- the admin demotion flow now uses the atomic IPA demotion implementation directly instead of composing `switch-provider(local)` and `set-profile(guest)` in the app service layer

Status:

- fixed

#### SEC-4: Accounts admin notify flow allowed unsanitized HTML interpolation

Impact:

An admin-authored notification message was interpolated into `rawHtml` without escaping before storage and delivery. Email sending already sanitized HTML before transport, but the unsanitized stored content unnecessarily enlarged the risk surface for downstream rendering or resend flows.

Remediation:

- escaped admin message content before converting line breaks into paragraph HTML in `packages/apps/src/accounts/frontend/users/detail/UserActions.island.tsx`
- kept the existing email-layer sanitization as defense in depth

Status:

- fixed

#### SEC-5: IPA group mutation routes did not fail cleanly on expired IPA sessions

Impact:

Group member/manager mutation routes fetched the current IPA session but did not reject `null` before passing the request to IPA-backed mutations. Expired sessions therefore failed deeper in the stack with less clear errors.

Remediation:

- added a provider-aware group mutation preflight in `packages/apps/src/accounts/api/groups.ts`
- local groups still proceed without an IPA session
- IPA groups now return a clean `401` with `IPA session expired` before attempting the mutation

Status:

- fixed

## Verified Security Properties

### 1. Provider-aware mutation validation

Verified in `packages/core/src/services/accounts/users.ts`.

The unified user service explicitly rejects invalid provider/action combinations:

- IPA users cannot use direct `setProfile`
- local users cannot use `resetPassword`
- IPA session is required for IPA-backed create/update/delete/expiry/switch flows
- login-link sending is limited to local users

### 2. FreeIPA-first mutation ordering

Verified in:

- `packages/core/src/services/accounts/users.ts`
- `packages/core/src/services/ipa/users.ts`

IPA-backed flows still perform remote mutation first and only mirror the local projection on confirmed success. This avoids local/remote divergence on failed IPA writes.

### 3. Identity preservation on provider switches

Verified in:

- `packages/core/src/services/accounts/users.ts`
- `packages/core/src/services/ipa/users.ts`

Provider switches preserve the existing local user row and UUID instead of replacing the account. This reduces identity confusion and avoids relation loss.

### 4. Provider-scoped relation cleanup

Verified in:

- `packages/core/src/services/accounts/switching.ts`
- `packages/core/src/services/accounts/users.ts`
- `packages/core/src/services/ipa/sync.ts`

IPA-only memberships and manager relations are removed only when a user stops being IPA-backed. Local relations are preserved.

### 5. Canonical expiry handling

Verified in:

- `packages/core/src/services/accounts/model.ts`
- `packages/core/src/services/account-lifecycle/index.ts`
- `packages/core/src/services/ipa/sync.ts`

Runtime expiry decisions now use canonical `account_expires`. Legacy expiry columns remain mirrored only for transition compatibility.

### 6. Sync safety on ambiguous matches

Verified in `packages/core/src/services/ipa/sync.ts:252-296`.

The `migrate` mode refuses ambiguous mail matches and skips local UID conflicts instead of forcing a destructive or ambiguous merge.

## Residual Security-Relevant Transition Caveats

These are not open vulnerabilities in the implemented flow, but they remain important transition constraints:

### 1. Accounts app is still the final legacy cleanup area

The backend/core and all non-Accounts apps now use canonical account semantics.

Remaining caveat:

- the Accounts app still has the final cleanup pass pending
- some Accounts-app-only routes and UI still reference older `ipa`/`realm` semantics

This is not an active vulnerability in the migrated backend, but it remains the final area where legacy account language and guards still exist.

### 2. Compatibility endpoints still exist

Still present:

- `POST /users/:id/create-ipa`
- `POST /users/:id/make-local`

They are wrappers around the canonical behavior and are not a direct security problem, but they enlarge the externally reachable surface until they are removed.

### 3. Legacy expiry columns are still dual-written

Still present:

- `ipa_account_expires`
- `guest_expires_at`

The canonical runtime now uses `account_expires`, but dual-write means there is still transitional complexity until old readers are removed.

### 4. Remaining structural security TODOs

These are not active vulnerabilities, but they remain worthwhile cleanup tasks:

- retire the remaining legacy `services/ipa/*` ownership so unified account behavior has fewer parallel execution paths
- drop `auth.users.realm` and deleted-account `previous_realm` once the Accounts app is migrated
- remove compatibility endpoint aliases once all callers use the canonical routes
- remove any final Accounts-app-only legacy guards and wording

## Schema Hygiene Notes

From a review and operational-safety perspective, the current `auth` schema now falls into four categories:

### 1. Active canonical runtime tables

- `users`
- `groups`
- `user_groups_v2`
- `group_groups_v2`
- `group_manager_users_v2`
- `group_manager_groups_v2`
- `account_requests`
- `access`
- `deleted_accounts`
- `account_lifecycle_reminders`

These are the tables the current runtime actually depends on.

### 2. Compatibility tables still needed for upgrades

- `user_groups`
- `group_groups`
- `group_manager_users`
- `group_manager_groups`

These are legacy `cn`-based relation tables. They are no longer the canonical runtime model, but they still matter for safe upgrades from older production schemas.

### 3. Migration-only artifact tables

- `account_requests_backup`

This should not be treated as part of the live account domain.

### 4. Old host-domain tables

- `hosts`
- `hostgroups`
- `host_hostgroups`
- `hostgroup_hostgroups`

These are no longer part of the account backend and should eventually be removed in a dedicated cleanup phase once upgrade implications are understood.

## Operational Caveat: `groups.cn` Still Matters

Even though the runtime group model is now `id + provider + name`, the old `groups.cn` column is still operationally significant because:

- older relation tables still reference it
- older production instances may still migrate from `cn`-based data
- existing schemas still keep `cn` non-null

Because of that, creating a local group must still populate a compatibility `cn` value. The current safe approach is:

- keep real IPA `cn` values for IPA groups
- generate synthetic `local:<name>` compatibility keys for local groups

This is not the final desired model, but it is the correct safety compromise while older upgrade paths still exist.

## Verification Commands

Reviewed and verified with:

- `bun run scripts/run-package-typechecks.ts`
- `bun run check:biome`

Repo note:

- `bun run typecheck` is still blocked globally by unrelated `check:skills` failures for missing `skills/*/agents/openai.yaml`

## Conclusion

After the review and the local-group authorization fix, and after the additional remediation pass for provider-switch session invalidation and atomic demotion, the migrated account backend is in a good security state for the implemented scope.

No open critical or high-severity issues remain in the changed account backend surface.
