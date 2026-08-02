# AI skills

`AiSkillsManagerBody` is the platform UI for personal, shared, and workspace AI skills. It uses the Cloud skills API directly; it is not a generic catalog component.

## Use AI skills

Embed `AiSkillsManagerBody` in the AI administration page, or call `openAiSkillsManager()` for the signed-in user's catalog.

Use `AiSkillsManagerDialog` and `AiSkillDetailDialog` only when a host needs direct control over the existing dialog composition.

## Import

```tsx
import { Button } from "@k2b/ui";
import {
  AiSkillsManagerBody,
  openAiSkillsManager,
} from "@valentinkolb/cloud/ai/ui";
```

## User and admin modes

`isAdmin={false}` shows the signed-in user's bounded catalog:

- personal skills;
- workspace skills;
- skills shared with the user;
- the user's activation state.

Shared skills remain inactive until the recipient enables them.

`isAdmin={true}` manages the workspace catalog, review queue, global enable state, and audit history. Admin search and listing are server-paged because the workspace catalog can grow independently of one user.

Set `fixedHeight` in a dialog. Omit it on a page where the host owns scrolling.

## Ownership and code approval

`SKILL.md` is the entry point and source of the skill description. Skill files, sharing, activation, history, ZIP import, and download use the platform API at `/api/ai/skills`.

Personal skills are content-only. Workspace skills may run code only after an administrator approves the exact file contents. Changing a file revokes that approval.

The manager reflects permissions returned by the server. Server routes remain responsible for authentication, sharing rules, file limits, approval, and audit events.

## Accessibility

Catalog rows use buttons for detail navigation and labeled switches for activation. Detail sections use tabs with an accessible group label. File review inherits the keyboard behavior of `FileBrowserPanel`.

Keep skill names and descriptions meaningful without origin or approval badges.

## Runtime

The manager requires hydration, an authenticated Cloud session, and the platform skills routes. It loads data through the typed Cloud API client and wraps writes in shared mutations.

Do not render it on an anonymous page or point it at an app-local skills endpoint.

The manager has no injectable client seam. A component catalog or test without
the authenticated `/api/ai/skills` routes must present a static integration
reference instead of rendering working controls. Never replace or patch the
global browser fetch function to simulate this component: that changes
networking for the entire page and can intercept unrelated requests.

## Example

```tsx
// User-facing dialog
<Button variant="secondary" onClick={() => void openAiSkillsManager()}>
  Manage AI skills
</Button>

// Workspace administration page
<AiSkillsManagerBody isAdmin fixedHeight />
```
