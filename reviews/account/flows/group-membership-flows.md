# Flow Review: Group Membership Flows

## Scope

Flows 11-14 from the required list.

---

## Flow 11: Add member to local group

**Intended behavior:** Admin or group manager adds a user to a local group.

**Code path:**
1. `api/groups.ts POST /:id/members` -> `auth.requireRole("user")` + `requireGroupMutationContext`
2. `requireGroupMutationContext` (line 50):
   - Fetches group (first fetch)
   - Calls `requireLocalGroupManageAccess` which fetches the group again (second fetch)
   - For local groups: checks if user is admin or a manager of the group
   - For IPA groups: skips check entirely (returns null = granted) -- **AG-01**
3. `accountsService.group.addMember()` in `groups.ts` facade:
   - Calls `resolveProvider()` (third fetch of the same group)
   - Delegates to `localGroups.addMember()` for local groups
4. `local-groups.ts:addMember()`:
   - If adding a group: checks cycle detection via `wouldCreateLocalGroupCycle()`
   - Inserts into `auth.user_groups_v2` or `auth.group_groups_v2`
   - No profile recalculation needed (local groups don't affect IPA profile)

**Issues found:**
- **Triple fetch of the same group** (API access check, access check helper, then facade resolveProvider).
- **No profile recalculation** is needed and correctly omitted. Local group membership does not affect `profile` derivation.

**Verdict:** Correct. Performance concern from triple fetch.

---

## Flow 12: Add member to IPA group

**Intended behavior:** Admin or group manager adds a user to an IPA group.

**Code path:**
1. `api/groups.ts POST /:id/members` -> same entry as Flow 11
2. `requireGroupMutationContext`:
   - For IPA groups: `requireLocalGroupManageAccess` returns `null` (skips check) -- **any "user" can reach this**
   - IPA session is fetched for the admin
3. `accountsService.group.addMember()`:
   - `resolveProvider()` returns "ipa"
   - Delegates to `providers.ipa.groups.addMember()`
4. `ipa/groups.ts:addMember()`:
   - If adding a user: calls `freeipa.client.call("group_add_member", ...)`, then inserts into `auth.user_groups_v2`, then calls `updateUserIpaProfile()`
   - If adding a group: calls FreeIPA API, then inserts junction row, then updates all affected users' profiles

**Issues found:**
- **API-level authorization gap for IPA groups** (AG-01). The app layer does not enforce admin/manager checks for IPA groups -- it only requires a valid IPA session (`requireGroupMutationContext` lines 65-77). FreeIPA enforces its own ACLs downstream and would reject unauthorized operations, but the app layer should provide its own explicit gate for defense in depth.
- **No transaction wrapping** between junction insert and profile update (IG-02). If profile update fails, the junction row is committed but profile is stale.
- **Profile recalculation triggers N+1** when adding a sub-group (IG-01).

**Verdict:** Works if FreeIPA enforces permissions. Authorization gap at the API layer.

---

## Flow 13: Add manager to local group

**Intended behavior:** Admin or existing manager adds a user as manager of a local group.

**Code path:**
1. `api/groups.ts POST /:id/managers` -> same auth chain as members
2. Same `requireGroupMutationContext` flow
3. `localGroups.addManager()`:
   - Inserts into `auth.group_manager_users_v2` or `auth.group_manager_groups_v2`
   - No cycle detection for manager hierarchy
   - No profile recalculation

**Issues found:**
- **No cycle detection for manager groups.** A group can be made manager of a group that manages it, creating a circular management chain. This is probably fine since management is not hierarchically resolved, but it's worth noting.

**Verdict:** Correct. No cycle detection needed for non-hierarchical management.

---

## Flow 14: Add manager to IPA group

**Intended behavior:** Admin adds a user/group as manager of an IPA group.

**Code path:**
1. Same API entry as Flow 13
2. Delegates to `providers.ipa.groups.addManager()`
3. `ipa/groups.ts:addManager()`:
   - If adding a user: validates the user is IPA-backed (unlike local groups which allow mixed providers)
   - Calls `freeipa.client.call("group_add_member_manager", ...)`
   - Inserts into `auth.group_manager_users_v2`

**Issues found:**
- **IPA groups correctly enforce that managers must be IPA users.** This is a stricter rule than local groups.
- **Same API authorization gap as Flow 12** -- any user with a valid IPA session can attempt this. FreeIPA ACLs are the actual gate.

**Verdict:** Correct enforcement at the IPA level. Missing explicit app-level authorization (defense in depth).

---

## Cross-flow Issues

| Issue | Affected Flows | Severity |
|-------|---------------|----------|
| Triple group fetch per mutation | 11, 12, 13, 14 | Medium |
| API auth gap for IPA groups (defense in depth) | 12, 14 | Medium |
| No transaction on IPA junction+profile | 12 | Medium |
| N+1 profile update on sub-group add | 12 | Medium |

## Conclusion

Local group membership flows are clean and correct. IPA group flows work correctly at the FreeIPA level but have a defense-in-depth gap at the API layer (any user with a valid IPA session can attempt mutations, relying on FreeIPA ACLs as the only gate). The triple-fetch pattern for group mutations is a consistent performance issue. Profile recalculation after IPA group changes is correct but not transactional.
