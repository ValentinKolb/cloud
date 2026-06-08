# FreeIPA Subsession Removal Readiness

This note records the current readiness state for removing stored FreeIPA
subsessions from Cloud sessions. It is an assessment only; it does not remove
`SessionData.ipaSession` or change the FreeIPA execution model.

## Recommendation

Do not remove stored `ipaSession` yet.

The Cloud-side audit layer and Accounts service authorization checks are now in
place, so the next migration can start moving FreeIPA mutations to service
account execution. The stored user `ipaSession` should remain until those
callers have been converted and verified route by route. Password changes should
keep using fresh credential verification instead of service-account execution.

## Remaining Dependencies

| Area | Current dependency | Planned replacement |
|------|--------------------|---------------------|
| Cloud session storage | `packages/cloud/src/services/session/index.ts` stores `{ userId, ipaSession, gen }` and exposes `getIpaSession()` | Remove `ipaSession` only after all callers stop requiring it. Keep `gen` and user id session data. |
| Login/password-change routes | `packages/cloud/src/api/auth.ts` stores the IPA session returned by FreeIPA login or password-change flows | Keep until mutation callers no longer use it. Login still validates credentials through FreeIPA. |
| `/me` profile update | `packages/cloud/src/api/me.ts` passes the stored session to `accountsService.user.update()` for IPA users | Move to service-account execution after the service confirms `actor.userId === targetUserId` and audits the result. |
| `/me` account extension | `packages/cloud/src/api/me.ts` passes the stored session to `accountLifecycle.extendCurrentUserAccount()` | Move to service-account execution. The service already owns the "never expire cannot be extended" rule and should audit allowed/failed outcomes. |
| `/me` self-delete | `packages/cloud/src/api/me.ts` passes the stored session to `accountsService.user.removeSelf()` | Move guest self-delete to service-account execution after Cloud verifies `profile === "guest"` and `actor.userId === targetUserId`. |
| Own password change | `accountsService.user.changeOwnPassword()` verifies the current password and uses the fresh FreeIPA session returned by verification | Keep this fresh-credential flow. Do not use a service account for changing a user's own password. |
| Accounts user admin routes | `packages/accounts/src/api/users.ts` reads `auth.session.getIpaSession()` for IPA create/update/reset/switch/set-expiry/remove/demote flows | Move admin mutations to a configured FreeIPA service account after Cloud service authorization and audit checks pass. |
| Accounts group admin routes | `packages/accounts/src/api/groups.ts` already uses service-account sessions for admin IPA group operations through `requireAdminIpaSession()` | Keep this pattern and move the remaining non-admin manager paths to service-account execution once Cloud manager checks are verified. |
| Group manager mutations | Non-admin IPA group managers still use the actor's stored FreeIPA session for member/manager changes | Use Cloud recursive managed-group authorization plus service-account execution. FreeIPA should no longer be the primary group-manager authorization source. |
| Low-level IPA providers | `packages/cloud/src/services/ipa/users.ts` and `packages/cloud/src/services/ipa/groups.ts` accept caller-provided `ipaSession` | Keep these primitives for now. Add service-account wrappers or pass service-account sessions from the Accounts service facade in the migration task. |

## Service-Account Permissions

The configured FreeIPA service account must be able to perform every directory
mutation that Cloud authorizes:

- user create, modify, delete, and lookup;
- user account-expiry updates;
- admin password reset for users;
- group create, modify, delete, and lookup;
- group POSIX conversion where enabled;
- add/remove user and group members;
- add/remove user and group managers;
- read users, groups, memberships, and managers for sync and authorization
  context.

These permissions are intentionally broad. Cloud service-layer authorization and
audit logging become the authority that decides whether a mutation is allowed.
FreeIPA remains the directory backend and a second operational guardrail.

## Audit Coverage

Covered by the current Accounts service facade:

- admin user mutations, including denied admin/self-protection checks;
- self-service profile/password/self-delete operations;
- account extension lifecycle outcomes;
- group create/update/remove/POSIX operations;
- group member and manager mutations, including denied manager checks;
- account request create/withdraw/deny/complete flows;
- metadata sanitization for passwords, tokens, cookies, and `ipaSession`.

The Accounts admin UI exposes a searchable audit `DataTable` for actor, target,
action, outcome, provider, and time-range inspection.

Remaining verification gap:

- DB-backed integration tests should still assert that allowed and denied
  service operations write the expected `audit.events` rows. Current focused
  coverage exercises the pure authorization decisions and audit sanitizer; full
  write/list behavior should be covered before deleting the fallback
  `ipaSession` path.

## Rollback Strategy

Migrate one route family at a time while the stored `ipaSession` remains
available:

1. Keep the existing actor-session path in code until the service-account path
   is verified for that operation.
2. Switch the operation in the Accounts service facade, not in the HTTP route.
3. Audit the same action names before and after the switch so behavior can be
   compared.
4. If a service-account permission is missing or too broad, roll the operation
   back to the actor-session path and fix FreeIPA permissions separately.
5. Remove `SessionData.ipaSession` only after no production caller reads
   `auth.session.getIpaSession()`.

## Operational Risks

- A misconfigured service account can turn Cloud authorization bugs into
  directory-wide mutation capability. Keep the service facade small and tested.
- Manager authorization must compare stable group IDs, not display names.
- Password-change flows need fresh user credentials and should not be folded
  into generic service-account execution.
- Local development without FreeIPA must keep working; service-account lookup
  failures must stay scoped to IPA-backed mutations.
