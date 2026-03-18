# Accounts Frontend UX Consistency Review

## 1. Executive Summary

The Accounts frontend presents a mostly coherent new account model (provider + profile) with a well-structured dashboard, groups section, and admin tooling. The main risk areas are:

- **FreeIPA terminology leaking to normal users** who have no reason to know what FreeIPA is
- **Inconsistent label vocabulary** across pages ("Managed by", "Provider", "Access Level" used interchangeably)
- **Group scope filter defaults** that silently change based on role, which can confuse users who share links or switch roles
- **The /me page and /app/accounts dashboard showing overlapping but subtly different information**, creating uncertainty about which is authoritative
- **Several admin actions that lack sufficient guardrails** or use surprising labels ("Destroy", "Use Local", "Make POSIX")

The overall structure is solid. Most findings below are about **wording, consistency, and the mental model gap** between what the code exposes and what a non-technical user would understand.

---

## 2. Review Scope

- All files under `packages/apps/src/accounts/frontend/`
- `packages/core/src/pages/me/page.tsx` and related islands
- `packages/lib/src/shared/account-display.ts` (shared label helpers)
- Reviewed from three personas: normal user, admin, confused user

---

## 3. Findings

### F-01 | High | "FreeIPA" terminology exposed to non-technical users

**Why it's confusing:** The dashboard page (`page.tsx:126-128`, `page.tsx:135-136`) shows text like _"FreeIPA-backed accounts derive their effective access from FreeIPA group membership"_ and _"Request a FreeIPA-managed account to unlock FreeIPA-backed access and group-derived permissions"_ to **all local users**, including guests. A confused user has no idea what FreeIPA is, what "group-derived permissions" means, or why they should care.

The request button itself says "Request FreeIPA Access" (`RequestFreeIpaAccess.island.tsx:165-168`), and the form title is "Request [AppName] FreeIPA Access" (line 67). The success message says "Your FreeIPA access request has been submitted" (line 56).

**Who it affects:** All local users (especially non-technical ones), guests.

**Suggestion:** Consider user-facing labels like "Request Full Account" or "Request Organization Account". FreeIPA can remain in admin views and technical contexts.

---

### F-02 | High | "Provider" vs "Managed by" vs "Access Level" vs "Account Type" — inconsistent labeling

The same underlying concepts are labeled differently across pages:

| Location | Label used | Concept |
|---|---|---|
| Dashboard (`page.tsx:109`) | "Access Level" | profile (user/guest) |
| Dashboard (`page.tsx:113`) | "Managed By" | provider (ipa/local) |
| User detail (`detail/page.tsx:184`) | "Provider" | provider (ipa/local) |
| User detail (`detail/page.tsx:187`) | "Account Type" | profile (user/guest) |
| Users filters (`UsersFilters.island.tsx:38`) | "Managed by" | provider |
| Users filters (`UsersFilters.island.tsx:47`) | "Access level" | profile |
| Create user dialog (`CreateUserForm.island.tsx:239`) | "Access level" | profile |
| Create user confirmation (`CreateUserForm.island.tsx:84`) | "Managed by" | provider |
| Shared helper (`account-display.ts:11`) | "Managed by FreeIPA" / "Managed locally" | provider |

The user detail page uses "Provider" (line 184) and "Account Type" (line 187), while everywhere else uses "Managed by" and "Access level". This is a direct inconsistency — the admin sees different labels for the same data depending on which page they're on.

**Who it affects:** Admins, group managers.

---

### F-03 | High | Dashboard and /me show overlapping info with subtle differences

Both `/me` and `/app/accounts` (dashboard) show the user's account badges, groups, management status, and expiry. The differences are:

1. `/me` shows groups as tag-links that search the groups page (`me/page.tsx:246`), while the dashboard shows group count cards that navigate with scope presets (`page.tsx:164-186`).
2. `/me` shows "Manages" as group name tags (`me/page.tsx:274-294`), while the dashboard shows "Managed by me" as a count card.
3. `/me` shows "Extend Account" button (`ProfileActions.island.tsx:335-337`), but the dashboard does not mention self-service expiry extension at all.
4. The dashboard says "Open my profile" as a small link in the top-right corner (`page.tsx:91-93`), giving `/me` secondary billing.

A user trying to extend their account would need to go to `/me`, but the dashboard doesn't hint at this. The mental model question: **"Is /me or the dashboard the canonical place for my account info?"** remains unresolved.

**Who it affects:** All users, especially new ones navigating between the two.

---

### F-04 | Medium | Group scope default silently changes based on role

In `page.tsx:49` and `groups/page.tsx:24`, the default scope is computed as:
```
isAdmin ? "all" : user.managesGroupIds.length > 0 ? "managed" : "member"
```

This means:
- An admin sharing a groups URL without `?scope=` will see "all groups" by default
- A group manager sees "managed" by default
- A regular user sees "member" by default

If an admin shares a link like `/app/accounts/groups` with a group manager, the manager sees a different view than the admin intended. The scope filter chip shows the currently active scope, but there's no visible indication that a default was applied rather than explicitly chosen.

**Who it affects:** Anyone sharing links; group managers who become admins or vice versa.

---

### F-05 | Medium | GroupSidebar shows raw scope value as label

In `GroupSidebar.island.tsx:49`, the sidebar shows `{props.listState.scope}` directly — this renders raw values like "managed", "member", or "all" as-is. These are internal values, not user-facing labels. Compare with `GroupsScopeFilter.island.tsx` which has proper labels ("Managed by me", "My groups", "All groups").

**File:** `packages/apps/src/accounts/frontend/groups/GroupSidebar.island.tsx:49`

**Who it affects:** All users seeing the group detail sidebar.

---

### F-06 | Medium | "Destroy" as the deletion label for users is jarring

`UserActions.island.tsx:595-599` uses "Destroy" as the label for permanently deleting a user. The confirmation dialog says `Destroy "${uid}"?` (line 458). While technically accurate (it's irreversible), "Destroy" reads as aggressive compared to the "Delete" label used for groups (`GroupActions.island.tsx:170-175`).

This inconsistency means admins see "Delete" for groups but "Destroy" for users for conceptually the same severity of action.

**Who it affects:** Admins.

---

### F-07 | Medium | "Use FreeIPA" / "Use Local" action labels are unclear

In the user actions dropdown (`UserActions.island.tsx:548-588`):
- "Use Local" (for switching an IPA user to local provider)
- "Use FreeIPA" (for switching a local user to IPA provider)

These labels don't communicate what will actually happen. "Use Local" could be misread as "use this account locally" or "make this my local account." The confirmation dialogs are more detailed, but the dropdown labels themselves could easily lead to an accidental click.

**Who it affects:** Admins.

---

### F-08 | Medium | Admin edit form shows IPA sync warning for all users

In `UserActions.island.tsx:232-236`, the "Edit User" form shows:
> _"The email address is the primary sync key between FreeIPA and the local database. Changing it may affect account linking."_

This warning appears for **all** users including purely local ones, where IPA sync is irrelevant. The warning should be conditional on `props.user.provider === "ipa"`.

**File:** `packages/apps/src/accounts/frontend/users/detail/UserActions.island.tsx:232-236`

**Who it affects:** Admins editing local users (misleading warning).

---

### F-09 | Medium | /me shows raw role strings like "group-manager"

In `me/page.tsx:109-119`, supplemental roles are rendered directly:
```tsx
{role}
```
This shows the raw value `"group-manager"` with the hyphen, as-is. The accounts pages use `getSupplementalRoles()` which filters to the same values but they're displayed as raw strings in both places. Consider a display mapping (e.g. "Group Manager").

**Who it affects:** All users with supplemental roles.

---

### F-10 | Medium | /me "expired" badge only shows for guests, not full users

In `me/page.tsx:120-124`:
```tsx
{isGuestProfile && isExpiredAccount && (
  <span ...>expired</span>
)}
```

The expired badge on `/me` is only shown for guest accounts. But on the dashboard (`page.tsx:101-105`), the "Expired" badge shows for **all** expired accounts regardless of profile. An IPA user whose account has expired would see "Expired" on the dashboard but not on their `/me` page.

**Who it affects:** Expired IPA users or expired local full users.

---

### F-11 | Medium | Create user from request allows choosing "local" provider

When processing a pending FreeIPA access request via the requests page (`requests/page.tsx:103-114`), clicking "Create" opens `CreateUserForm` with `prefill` data. However, `CreateUserForm` line 409 shows:
```tsx
if (props.prefill) return "ipa";
```

This correctly skips the provider selection when prefill is present. But the "Create" button on the requests page (`requests/page.tsx:68`) also renders a standalone `CreateUserForm` without prefill, which opens the full flow. An admin might click the top-level "New User" button intending to process a request, but end up in the generic creation flow instead. The proximity of these two buttons could cause confusion.

**Who it affects:** Admins processing requests.

---

### F-12 | Low | "Make POSIX" action lacks explanation for non-sysadmin admins

`GroupActions.island.tsx:115` shows:
> _Convert "[name]" to a POSIX group? This will assign a GID number and cannot be undone._

An admin who doesn't know what POSIX groups are would have no idea what "assign a GID number" means or why it can't be undone. The action appears in the dropdown without further context.

**Who it affects:** Non-technical admins.

---

### F-13 | Low | NFS follow-up commands shown to all admins

After creating an IPA user (`CreateUserForm.island.tsx:368-381`) or deleting one (`UserActions.island.tsx:472-489`), a `sudo nfsctl` command is shown. Similarly for POSIX group creation/deletion. These NFS commands are shown to all admins, but only a subset (sysadmins with NFS server access) can actually run them. Other admins may find this confusing.

**Who it affects:** Non-sysadmin admins.

---

### F-14 | Low | Group delete success message says "deleted from FreeIPA" for all groups

`GroupActions.island.tsx:30`:
```tsx
await prompts.alert(`Group "${g}" deleted from FreeIPA.`, ...);
```

This message appears for **all** deleted groups (both IPA and local), but says "deleted from FreeIPA" regardless of provider. Local group deletions shouldn't mention FreeIPA.

**File:** `packages/apps/src/accounts/frontend/groups/detail/GroupActions.island.tsx:30`

**Who it affects:** Admins deleting local groups.

---

### F-15 | Low | Group detail "Member Of" tab only visible to admins — no explanation

In `groups/detail/page.tsx:310-328`, the "Member Of" tab is only rendered for admins. A group manager who can manage members and managers has no visibility into the group hierarchy. There's also no hint that this tab exists but is restricted.

**Who it affects:** Group managers curious about group hierarchy.

---

### F-16 | Low | Group actions dropdown only shows for admins, not group managers

In `groups/detail/page.tsx:230-232`:
```tsx
{isAdmin && (
  <GroupActions ... />
)}
```

The group actions (Edit, Delete, Make POSIX) are admin-only. A group manager who `canManage` can add/remove members but cannot edit the group description. This may be intentional, but a group manager visiting their group might expect to edit the description.

**Who it affects:** Group managers.

---

### F-17 | Low | Inconsistent back button labels

- User detail: "All Users" (`users/detail/page.tsx:139`)
- Group detail: dynamic label like "Managed Groups" / "My Groups" / "All Groups" (`groups/detail/page.tsx:207`)

The user detail always says "All Users" regardless of which filter/scope was active, while the group detail adapts its back label to the list context. Minor inconsistency but the group approach is better.

**Who it affects:** Admins navigating between list and detail views.

---

### F-18 | Low | MembersTab pagination URL loses list context

In `MembersTab.tsx:27-29`, pagination URLs are built with a hardcoded path:
```tsx
`/app/accounts/groups/${props.groupId}?tab=members${indirectParam}&page=`
```

This doesn't carry over the `list_search`, `list_scope`, `list_page` context query keys. After paginating within the members tab, clicking back to the groups list would lose the user's previous list position.

**File:** `packages/apps/src/accounts/frontend/groups/detail/MembersTab.tsx:27-29`

**Who it affects:** Anyone browsing group members with pagination.

---

### F-19 | Low | Dashboard "Lifecycle Signals" section uses jargon

The admin dashboard section "Lifecycle Signals" with subtitle "Current pressure points" (`page.tsx:230-231`) is heavily jargon-laden. Terms like "lifecycle pressure", "reminder errors", "eligible for cleanup now" assume operational familiarity. A new admin might not understand what "Guests past expiry — Eligible for cleanup now" means in practice.

**Who it affects:** New admins.

---

### F-20 | Low | "Database ID" shown on user detail page

`users/detail/page.tsx:178`:
```
Database ID: {user.id}
```

The raw database UUID is shown as the first detail field on the user page. This is only useful for debugging. Normal admin tasks don't need it, and it pushes more useful info like UID and email down.

**Who it affects:** Admins (clutter).

---

## 4. User Confusion Risks

### For a normal user:
1. **"What is FreeIPA?"** — The dashboard mentions it prominently but never explains what it is or why the user should care. The request flow asks them to explain why they need a "FreeIPA-managed account."
2. **"Where is my real profile?"** — Both `/me` and `/app/accounts` show account info. The user doesn't know which to trust or which has more actions.
3. **"Why does 'Extend Account' only exist on /me?"** — If the user's account is expiring, the dashboard shows expiry info but offers no action. They have to find `/me` to extend.

### For an admin:
1. **"Destroy" vs "Delete"** — Different verbs for equally permanent actions on users vs groups.
2. **"Use Local" / "Use FreeIPA"** — Ambiguous dropdown labels that don't preview the consequence.
3. **The IPA sync warning appearing for local users** could make an admin hesitant to edit a local user's email.
4. **"deleted from FreeIPA"** showing for local groups is a clear bug.

### For a confused user:
1. Every label involving "FreeIPA", "provider", "POSIX", "GID", "Kerberos" is opaque.
2. The group scope filter defaults silently, so they may not realize they're looking at a filtered view.
3. The raw "group-manager" role badge is unhelpful.

---

## 5. Open Questions

1. **Should non-admin users ever see "FreeIPA" in the UI?** The current request flow requires them to understand this term. Would "Organization Account" or "Full Directory Account" work better?
2. **Should `/me` and the dashboard be more clearly separated?** Currently they overlap significantly. Could the dashboard link explicitly to `/me` for actions like "Extend Account"?
3. **Should group managers be able to edit group descriptions?** The `canManage` flag grants member management but not metadata editing.
4. **Is the "Member Of" tab intentionally hidden from group managers?** If yes, should there be a read-only version?
5. **Is the NFS follow-up step something that should be automated** rather than shown as a copy-paste command?

---

## 6. Overall Verdict

The Accounts frontend is structurally sound with a clear layout, good use of dialogs for destructive actions, and a working new account model. The main issues are:

- **Vocabulary inconsistency** (F-02) that makes the same data look different on different pages
- **FreeIPA terminology leak** (F-01) that makes the UI feel technical for normal users
- **The /me vs dashboard overlap** (F-03) that creates ambiguity about where to go
- **One likely bug** (F-14) where local group deletions wrongly reference FreeIPA

None of these are blocking, but fixing F-01, F-02, F-08, and F-14 would meaningfully improve clarity for both admins and normal users.
