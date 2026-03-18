# Accounts App Review — v3

## 1. Executive Summary

The Accounts app has been substantially migrated to the canonical `provider`/`profile` model. The page structure, navigation, badge system, and group workspace are well-designed and conceptually clean. The dashboard correctly serves both regular users and admins, the request flow is properly scoped to local accounts, and the group workspace is accessible to all full-account users.

However, this review identifies **15 findings** including **1 critical XSS vulnerability**, **3 medium-severity bugs**, and several usability/accessibility/consistency issues. The most impactful issues are an HTML injection path in the admin notify feature, duplicate property declarations that silently corrupt data, and missing IPA session guards on group mutation API routes.

---

## 2. Review Scope

### Files reviewed

**Pages & routes:**
- `packages/apps/src/accounts/pages.ts`
- `packages/apps/src/accounts/frontend/page.tsx` (dashboard)
- `packages/apps/src/accounts/frontend/AccountsNavSidebar.tsx`
- `packages/apps/src/accounts/frontend/users/page.tsx`
- `packages/apps/src/accounts/frontend/users/new/page.tsx`
- `packages/apps/src/accounts/frontend/users/detail/page.tsx`
- `packages/apps/src/accounts/frontend/groups/page.tsx`
- `packages/apps/src/accounts/frontend/groups/detail/page.tsx`
- `packages/apps/src/accounts/frontend/requests/page.tsx`
- `packages/apps/src/accounts/frontend/deleted-accounts/page.tsx`
- `packages/apps/src/accounts/frontend/reminders/page.tsx`

**Islands:**
- `CreateUserForm.island.tsx`, `UserActions.island.tsx`, `AddToGroup.island.tsx`
- `UserSidebar.island.tsx`
- `GroupSidebar.island.tsx`, `NewGroup.island.tsx`, `GroupActions.island.tsx`
- `MembersTab.tsx`, `ManagersTab.tsx`, `MemberOfTab.tsx`
- `AddMember.island.tsx`, `RemoveMember.island.tsx`, `AddGroupToGroup.island.tsx`, `RemoveFromGroup.island.tsx`
- `RequestFreeIpaAccess.island.tsx`, `WithdrawAccountRequest.island.tsx`
- `AdminOperations.island.tsx`
- `DeletedAccountsFilters.island.tsx`, `ReminderFilters.island.tsx`

**API routes:**
- `packages/apps/src/accounts/api/users.ts`
- `packages/apps/src/accounts/api/groups.ts`
- `packages/apps/src/accounts/api/account-requests.ts`

**Services:**
- `packages/apps/src/accounts/service/users.ts`
- `packages/apps/src/accounts/service/groups.ts`
- `packages/apps/src/accounts/service/admin.ts`
- `packages/apps/src/accounts/service/account-requests.ts`
- `packages/apps/src/accounts/service/index.ts`

**Contracts:**
- `packages/apps/src/accounts/contracts.ts`

**Supporting files:**
- `packages/apps/src/accounts/frontend/lib/url-state.ts`
- `packages/apps/src/accounts/frontend/lib/account-badges.ts`
- `packages/lib/src/server/middleware/auth.ts`
- `packages/lib/src/ui/ipa/UserView.tsx`
- `packages/lib/src/ui/ipa/GroupView.tsx`
- `packages/lib/src/ui/misc/EntitySearch.tsx`
- `packages/core/src/pages/me/page.tsx`
- `packages/core/src/pages/me/ProfileActions.island.tsx`
- `packages/core/src/pages/me/ProfileSettings.island.tsx`
- `packages/core/src/services/accounts/users.ts`
- `packages/core/src/services/accounts/groups.ts`
- `packages/core/src/services/accounts/authz.ts`
- `packages/core/src/api/me.ts`

---

## 3. Findings

### F-01 — CRITICAL — Stored XSS via admin "Notify" action

| Field | Value |
|-------|-------|
| **Severity** | Critical |
| **Category** | Security |
| **File** | `packages/apps/src/accounts/frontend/users/detail/UserActions.island.tsx:177` |

**Impact:** An admin can inject arbitrary HTML/JavaScript that gets stored and rendered to the target user's email or in-app notification view.

**Explanation:**

```typescript
// UserActions.island.tsx:177
rawHtml: `<p>${content.replace(/\n/g, "</p><p>")}</p>`,
```

The `content` variable comes directly from user input (the admin's message text area) and is injected into raw HTML with only newline replacement. There is no HTML entity escaping. An admin could enter:

```
<script>alert('xss')</script>
```

or more subtly:

```
<img src=x onerror="fetch('/api/me',{method:'DELETE'})">
```

This HTML is passed as `rawHtml` to the notifications API, which stores and renders it. While this requires admin privileges, it still represents a stored XSS vector — a compromised admin account or social engineering could exploit this to execute JavaScript in other users' browsers.

**Fix:** Escape HTML entities in `content` before interpolating, or use a text-to-HTML conversion that safely encodes `<`, `>`, `&`, `"`.

---

### F-02 — MEDIUM — Duplicate property in `mapSummary` silently drops `localUsersTotal`

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **Category** | Bug |
| **File** | `packages/apps/src/accounts/service/admin.ts:37-38` |

**Impact:** The dashboard summary object has `ipaUsersTotal` assigned twice. If the SQL query were to return a `local_users_total` column, the intended property would be silently overwritten. Currently the duplicate just re-assigns the same value, but this is a clear copy-paste bug.

**Explanation:**

```typescript
// admin.ts:37-38
ipaUsersTotal: Number(row.ipa_users_total ?? 0),
ipaUsersTotal: Number(row.ipa_users_total ?? 0),  // ← duplicate
```

The second line overwrites the first. If a `localUsersTotal` field was intended here (which seems likely given the dashboard shows separate IPA and guest counts), it is missing.

**Fix:** Determine whether line 38 should be a different field (e.g., `localUsersTotal`) and correct the property name.

---

### F-03 — MEDIUM — Duplicate `runReminders` method in admin service

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **Category** | Bug |
| **File** | `packages/apps/src/accounts/service/admin.ts:132-133` |

**Impact:** The `jobs` object has `runReminders` defined twice. The second definition silently overwrites the first. While both appear identical, this is a symptom of copy-paste error — a different job method (e.g., `runGuestCleanup` or `runLocalUserBackfill`) may have been intended.

```typescript
// admin.ts:132-133
runReminders: async (): Promise<string> => lifecycleJobs.submitReminderRun(),
runReminders: async (): Promise<string> => lifecycleJobs.submitReminderRun(),  // ← duplicate
```

**Fix:** Remove the duplicate or replace it with the missing job method.

---

### F-04 — MEDIUM — Duplicate variable declaration in account request denial

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **Category** | Bug |
| **File** | `packages/apps/src/accounts/service/account-requests.ts:262-263` |

**Impact:** `contactEmail` is declared twice with `const`. In strict mode this would be a syntax error; in the Bun runtime it may silently shadow. Either way it's a bug — one `const` assignment is wasted and creates confusion.

```typescript
// account-requests.ts:262-263
const contactEmail = await settings.get<string>("app.contact_email");
const contactEmail = await settings.get<string>("app.contact_email");  // ← duplicate
```

**Fix:** Remove the duplicate declaration.

---

### F-05 — MEDIUM — Missing IPA session null-check on group member/manager mutation API routes

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **Category** | Security / Correctness |
| **File** | `packages/apps/src/accounts/api/groups.ts:178-179, 217-218, 255-256, 293-294` |

**Impact:** For IPA groups, the member/manager add/remove routes fetch `ipaSession` but never check if it's null before passing it to the backend. If the session has expired, the backend receives `null` and will fail with an opaque IPA error rather than a clean 401.

**Explanation:**

```typescript
// groups.ts:178-179 (add member)
const token = c.get("sessionToken");
const ipaSession = await auth.session.getIpaSession(token);
// ipaSession could be null — no check before passing to backend
```

Compare with the admin user routes (`api/users.ts:187-188`) which explicitly use `requireIpaSession(c)` with proper error handling. The group member/manager routes skip this check.

For **local** groups this is fine (ipaSession is unused). For **IPA** groups, the request will fail at the IPA layer with a confusing error message instead of a clean "IPA session expired" response.

**Fix:** Either use the same `requireIpaSession` pattern, or add an explicit null check when the target group's provider is `ipa`.

---

### F-06 — LOW — Redundant ternary in CreateUserForm default provider

| Field | Value |
|-------|-------|
| **Severity** | Low |
| **Category** | Bug (dead code) |
| **File** | `packages/apps/src/accounts/frontend/users/new/CreateUserForm.island.tsx:94` |

**Impact:** Both branches of the ternary evaluate to `"ipa"`, making the conditional pointless.

```typescript
// CreateUserForm.island.tsx:94
const [provider, setProvider] = createSignal<"ipa" | "local">(props.prefill ? "ipa" : "ipa");
```

**Fix:** Either simplify to `createSignal<"ipa" | "local">("ipa")` or, if the intent was to default to a different provider for non-prefill cases, fix the second branch.

---

### F-07 — LOW — `/me` page badge labels inconsistent with Accounts app terminology

| Field | Value |
|-------|-------|
| **Severity** | Low |
| **Category** | Usability / Consistency |
| **File** | `packages/core/src/pages/me/page.tsx:42-61` |

**Impact:** The `/me` page uses legacy-style badge labels ("IPA", "IPA Guest", "Guest", "Local") while the Accounts app uses the canonical model labels ("Full account" / "Guest account" and "Managed by FreeIPA" / "Managed locally") via `account-badges.ts`.

This creates an inconsistent experience: the same user sees different terminology describing their account depending on which page they visit.

**Fix:** Import and use the shared `getPrimaryAccountBadge` / `getManagementBadge` utilities from `account-badges.ts` on the `/me` page, or create shared badge utilities in `packages/lib`.

---

### F-08 — LOW — `/me` page hides Groups card for local users

| Field | Value |
|-------|-------|
| **Severity** | Low |
| **Category** | UX regression |
| **File** | `packages/core/src/pages/me/page.tsx:218` |

**Impact:** The Groups card on `/me` is gated by `isIpaUser`:

```tsx
// me/page.tsx:218
{isIpaUser && (
```

Local users who are members of local groups see no group information on their profile page. The Accounts app dashboard does show group counts for all users, creating an inconsistency.

**Fix:** Show the Groups card for all users who have group memberships, not just IPA users.

---

### F-09 — LOW — Dashboard doesn't pass ToS/Privacy URLs to RequestFreeIpaAccess

| Field | Value |
|-------|-------|
| **Severity** | Low |
| **Category** | UX |
| **File** | `packages/apps/src/accounts/frontend/page.tsx:134-139` |

**Impact:** `RequestFreeIpaAccess` accepts `agbUrl`, `privacyUrl`, and `appName` props, but the dashboard page doesn't pass them:

```tsx
// page.tsx:134-139
<RequestFreeIpaAccess
  givenname={user.givenname}
  sn={user.sn}
  displayName={user.displayName}
  phone={user.phone ?? null}
/>
```

In the request form, the ToS and Privacy Policy links fall back to plain `<span>` text with no link. Users are asked to agree to policies they cannot read.

**Fix:** Load the ToS/Privacy URLs from settings and pass them to the component.

---

### F-10 — LOW — "Managed" scope toggle always visible even for non-managers

| Field | Value |
|-------|-------|
| **Severity** | Low |
| **Category** | UX |
| **File** | `packages/apps/src/accounts/frontend/groups/page.tsx:59-74` |

**Impact:** The scope toggle bar (Managed / Mine / All) is always rendered for all users. A user who manages no groups will see an empty "Managed" view with no explanation, which is confusing.

**Fix:** Either hide the "Managed" scope option for users who manage zero groups, or show an explanatory empty state (e.g., "You don't manage any groups yet").

---

### F-11 — LOW — Group detail back button text says "All Groups" regardless of scope

| Field | Value |
|-------|-------|
| **Severity** | Low |
| **Category** | UX |
| **File** | `packages/apps/src/accounts/frontend/groups/detail/page.tsx:201-204` |

**Impact:** The back button always reads "All Groups" even when the user navigated from the "Managed" or "Mine" scope. The `groupsListHref` correctly preserves the list state, but the button text doesn't reflect it.

```tsx
// groups/detail/page.tsx:201-204
<a href={groupsListHref} class="btn-secondary btn-sm">
  <i class="ti ti-arrow-left" />
  All Groups
</a>
```

**Fix:** Use the scope from `listState` to set appropriate text (e.g., "Back to Groups", "My Groups", "Managed Groups").

---

### F-12 — LOW — Accessibility: Tab navigation lacks ARIA semantics

| Field | Value |
|-------|-------|
| **Severity** | Low |
| **Category** | Accessibility |
| **File** | `packages/apps/src/accounts/frontend/groups/detail/page.tsx:268-316` |

**Impact:** The tab bar for Members / Managers / Member Of uses plain `<a>` links without `role="tablist"`, `role="tab"`, or `aria-selected` attributes. Screen readers cannot identify these as tabs.

```tsx
// groups/detail/page.tsx:268
<div class="flex items-center gap-1 border-b ...">
  <a href="..." class="px-3 py-2 ...">Members</a>
  ...
</div>
```

Since these are server-rendered page navigation (full page loads), using `<a>` is semantically correct for navigation. However, visually they present as tabs, so adding `role="tablist"` and `role="tab"` with `aria-selected` would improve screen reader experience.

**Fix:** Add `role="tablist"` to the container `<div>` and `role="tab"` + `aria-selected={tab === "members"}` to each tab link.

---

### F-13 — LOW — Accessibility: Scope toggle lacks group/pressed semantics

| Field | Value |
|-------|-------|
| **Severity** | Low |
| **Category** | Accessibility |
| **File** | `packages/apps/src/accounts/frontend/groups/page.tsx:58-75` |

**Impact:** The Managed/Mine/All toggle uses `<a>` tags styled as button pills. Screen readers see these as regular links with no indication of which is currently selected.

**Fix:** Add `role="group"` to the container and `aria-current="page"` to the active link.

---

### F-14 — INFO — `UserView.tsx` and `GroupView.tsx` still named under `ui/ipa/`

| Field | Value |
|-------|-------|
| **Severity** | Info |
| **Category** | Maintainability |
| **File** | `packages/lib/src/ui/ipa/UserView.tsx`, `packages/lib/src/ui/ipa/GroupView.tsx` |

**Impact:** These shared UI components are under the `ipa/` directory but are now used for all providers (local and IPA). The directory name is a legacy artifact that could confuse contributors.

**Fix:** Consider moving to `ui/accounts/` or `ui/shared/` to match the canonical model.

---

### F-15 — INFO — User detail page fetches groups with `perPage: 1000`

| Field | Value |
|-------|-------|
| **Severity** | Info |
| **Category** | Performance |
| **File** | `packages/apps/src/accounts/frontend/users/detail/page.tsx:82-88` |

**Impact:** The user detail page fetches up to 1000 groups in three separate queries (recursive members, managed groups, direct groups). For users in very many groups, this could cause slow page loads. Currently this is likely fine for the expected scale, but it's worth noting as a potential scalability concern.

---

## 4. Open Questions / Assumptions

1. **F-02: Was `localUsersTotal` intended?** The dashboard SQL query doesn't include a `local_users_total` column, and the type definition doesn't include it. But the duplicate `ipaUsersTotal` suggests a copy-paste error where a different metric was intended.

2. **Guest access to Accounts app:** The landing page (`pages.ts:14`) requires `requireRole("user")`, which excludes guests (`profile === "guest"`). This appears intentional per the spec ("It should work for all `user` accounts"), but it means guest accounts have zero access to the Accounts workspace — they can't even see their own groups. Is this desired?

3. **IPA group manager permissions:** For IPA groups, `requireLocalGroupManageAccess` passes through (returns null) because it only enforces permissions for local groups. IPA group management is delegated to FreeIPA's own permission model. This is architecturally sound but means the app trusts IPA to enforce permissions correctly — there's no defense-in-depth at the app layer for IPA group mutations.

4. **`/me` account request removal:** The spec says `/me` should no longer host the account request workflow. This has been correctly moved to the Accounts dashboard. However, `/me` still links to `/app/accounts` indirectly via group links. This seems fine.

---

## 5. Usability / Accessibility Notes

### Positive observations

- **Badge system** (`account-badges.ts`): Clean separation of "Full account" / "Guest account" as primary type and "Managed by FreeIPA" / "Managed locally" as secondary label. Consistently applied across users list, detail, and dashboard.
- **URL state management** (`url-state.ts`): Well-designed URL-driven state for search, pagination, and scope. List state is preserved across detail navigation via context query keys.
- **Create user flow**: Provider-first design with clear conditional profile selection for local accounts. Auto-generated display name from first/last name is a nice touch.
- **Request flow**: Clean separation — local users request IPA access from dashboard, admins process from requests page with direct "Create" link to prefilled form. Denial with optional email is well-implemented.
- **Group workspace**: All `user` accounts see Managed/Mine/All scopes. Group managers get the "you can manage this group" message without seeing admin-only actions.

### Wording concerns

- **`/me` page** still uses "IPA", "IPA Guest", "Local", "Guest" as primary badge labels (F-07). This teaches users the old model.
- **Group detail back button** always says "All Groups" even when coming from "Mine" or "Managed" (F-11).
- **NFS commands** in success dialogs (`CreateUserForm`, `UserActions`, `GroupActions`) reference `sudo nfsctl useradd/userdel`. These are operational reminders for admins, which is fine, but they could be confusing if non-sysadmin admins see them.

### Accessibility concerns

- Tab bars and scope toggles lack ARIA semantics (F-12, F-13).
- The `<details>` elements for SSH keys and mobile navigation use the native disclosure widget, which has reasonable accessibility out of the box.
- Action dropdowns use the `Dropdown` component — accessibility depends on its implementation (not reviewed here).
- Most interactive elements use proper `<button>` or `<a>` tags with appropriate semantics.

---

## 6. Overall Verdict

The Accounts app migration is **well-executed**. The canonical `provider`/`profile` model is cleanly reflected in the UI, the page structure is logical, and the authorization model is sound. The badge system, URL state management, and create/request flows are well-designed.

The **critical finding (F-01)** is an HTML injection vulnerability in the admin notify feature that should be fixed before production use. The **medium findings (F-02 through F-05)** are copy-paste bugs and a missing null-check that should be straightforward to fix. The remaining findings are minor UX consistency, accessibility, and terminology issues.

### Summary table

| ID | Severity | Category | Title |
|----|----------|----------|-------|
| F-01 | **CRITICAL** | Security | Stored XSS via admin "Notify" rawHtml injection |
| F-02 | MEDIUM | Bug | Duplicate `ipaUsersTotal` property in dashboard summary |
| F-03 | MEDIUM | Bug | Duplicate `runReminders` method in admin service jobs |
| F-04 | MEDIUM | Bug | Duplicate `contactEmail` const in account request denial |
| F-05 | MEDIUM | Security | Missing IPA session null-check on group member/manager API routes |
| F-06 | LOW | Bug | Redundant ternary in CreateUserForm default provider |
| F-07 | LOW | UX | `/me` badge labels inconsistent with Accounts app terminology |
| F-08 | LOW | UX | `/me` hides Groups card for local users |
| F-09 | LOW | UX | Dashboard doesn't pass ToS/Privacy URLs to request form |
| F-10 | LOW | UX | "Managed" scope toggle visible to non-managers |
| F-11 | LOW | UX | Back button text always says "All Groups" |
| F-12 | LOW | A11y | Tab navigation lacks ARIA semantics |
| F-13 | LOW | A11y | Scope toggle lacks group/pressed semantics |
| F-14 | INFO | Maintainability | `UserView`/`GroupView` still under `ui/ipa/` directory |
| F-15 | INFO | Performance | User detail fetches groups with `perPage: 1000` |
