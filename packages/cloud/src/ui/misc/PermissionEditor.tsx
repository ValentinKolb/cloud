import { mutation } from "@valentinkolb/stdlib/solid";
import { createSignal, For, Show } from "solid-js";
import type { AccessEntry, PermissionLevel, Principal } from "../../contracts/shared";
import Combobox, { type ComboboxOption } from "../input/Combobox";
import { prompts } from "../prompts";
import Avatar from "./Avatar";
import Dropdown from "./Dropdown";
import Placeholder from "./Placeholder";

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

/** The three grantable permission levels — `"none"` exists in the
 *  contract for resolution semantics but is never directly granted. */
export type GrantableLevel = Exclude<PermissionLevel, "none">;

/** Either a bare level (uses the default View / Edit / Manage label and
 *  icon) or an object with per-context overrides. */
export type AllowedLevel = GrantableLevel | { level: GrantableLevel; label?: string; icon?: string };

type PermissionEditorProps = {
  /** Initial access entries — caller stays the source of truth for
   *  what's stored on the resource; the editor only mutates locally
   *  on optimistic update. */
  initialEntries: AccessEntry[];

  /** Whether the current user can edit permissions. When `false`, the
   *  editor renders the entries read-only — no row dropdowns, no
   *  delete buttons, no add form. */
  canEdit?: boolean;

  /** Grant access. The caller closes over the resource id. */
  grantAccess: (principal: Principal, permission: GrantableLevel) => Promise<AccessEntry>;

  /** Update an existing entry's permission level. */
  updateAccess: (accessId: string, permission: GrantableLevel) => Promise<void>;

  /** Revoke an existing entry. The last entry IS deletable — for
   *  hierarchical resources the parent ACL still applies. */
  revokeAccess: (accessId: string) => Promise<void>;

  /** Allow granting `public` access from this editor. The
   *  authenticated principal is always allowed (no flag needed). */
  allowPublic?: boolean;

  /** Allow granting service accounts. Off by default so ordinary
   *  permission pickers stay user/group focused. */
  allowServiceAccounts?: boolean;

  /** Which levels the UI offers — and what they're called. Bare strings
   *  use the default labels (View / Edit / Manage). Objects override
   *  label and/or icon for per-context vocabulary (e.g. forms call
   *  write "Use", views call read "View"). When undefined, all three
   *  are offered with default labels. New entries are granted
   *  `allowedLevels[0]` on pick — the user upgrades via the row pill
   *  afterwards. */
  allowedLevels?: AllowedLevel[];
};

// ─────────────────────────────────────────────────────────────────────────
// Defaults & helpers
// ─────────────────────────────────────────────────────────────────────────

const DEFAULT_LABELS: Record<PermissionLevel, { label: string; icon: string }> = {
  read: { label: "View", icon: "ti-eye" },
  write: { label: "Edit", icon: "ti-pencil" },
  admin: { label: "Manage", icon: "ti-shield" },
  // Defensive — never granted by this editor, but renders correctly if
  // a legacy entry has permission === "none".
  none: { label: "No access", icon: "ti-ban" },
};

type ResolvedLevel = {
  level: GrantableLevel;
  label: string;
  icon: string;
};

/** Resolve the AllowedLevel union into a flat shape the renderer can
 *  loop over. Falls back to the default View / Edit / Manage list when
 *  no override is given. */
const resolveAllowedLevels = (allowed: AllowedLevel[] | undefined): ResolvedLevel[] => {
  const list = allowed && allowed.length > 0 ? allowed : (["read", "write", "admin"] as GrantableLevel[]);
  return list.map((entry) => {
    const level = typeof entry === "string" ? entry : entry.level;
    const override = typeof entry === "string" ? null : entry;
    const def = DEFAULT_LABELS[level];
    return {
      level,
      label: override?.label ?? def.label,
      icon: override?.icon ?? def.icon,
    };
  });
};

/** Resolve a stored entry's permission to a renderable {label,icon},
 *  preferring the caller's allowedLevels override and falling back to
 *  the platform defaults. Tolerates "none" / unknown legacy values. */
const resolveEntryDisplay = (permission: PermissionLevel, allowed: ResolvedLevel[]): { label: string; icon: string } => {
  const fromAllowed = allowed.find((a) => a.level === permission);
  if (fromAllowed) return fromAllowed;
  return DEFAULT_LABELS[permission] ?? DEFAULT_LABELS.none;
};

const getEntryDisplayName = (entry: AccessEntry): string => {
  if (entry.displayName) return entry.displayName;
  if (entry.principal.type === "authenticated") return "All users (incl. guests)";
  if (entry.principal.type === "public") return "Public";
  if (entry.principal.type === "user") return entry.principal.userId;
  if (entry.principal.type === "service_account") return entry.principal.serviceAccountId;
  return entry.principal.groupId;
};

const getPrincipalIcon = (principal: Principal): string => {
  switch (principal.type) {
    case "user":
      return "ti-user";
    case "group":
      return "ti-users-group";
    case "service_account":
      return "ti-key";
    case "authenticated":
      return "ti-lock-open-2";
    case "public":
      return "ti-world";
  }
};

const getPermissionColor = (level: PermissionLevel): string => {
  switch (level) {
    case "read":
      return "text-blue-500";
    case "write":
      return "text-amber-500";
    case "admin":
      return "text-purple-500";
    default:
      return "text-zinc-500";
  }
};

// Backend `/api/accounts/entities` shape (the subset we consume).
type ApiEntity =
  | { kind: "user"; user: { id: string; uid: string; displayName: string; mail: string | null } }
  | { kind: "group"; group: { id: string; name: string; description: string | null } }
  | {
      kind: "service_account";
      serviceAccount: {
        id: string;
        name: string;
        kind: "user_delegated" | "resource_bound";
        appId: string | null;
        resourceType: string | null;
        resourceId: string | null;
      };
    };

// ─────────────────────────────────────────────────────────────────────────
// PermissionEditor
// ─────────────────────────────────────────────────────────────────────────

export default function PermissionEditor(props: PermissionEditorProps) {
  const [entries, setEntries] = createSignal<AccessEntry[]>([...props.initialEntries]);
  const canEdit = () => props.canEdit !== false;
  const allowPublic = () => props.allowPublic === true;
  const allowed = () => resolveAllowedLevels(props.allowedLevels);
  const isSinglePicker = () => allowed().length === 1;

  // Defensive dev-warning: an empty allowedLevels array makes the editor
  // unable to grant anything.
  if (props.allowedLevels && props.allowedLevels.length === 0) {
    if (typeof console !== "undefined") {
      console.warn(
        "[PermissionEditor] `allowedLevels=[]` — the editor cannot grant any permission. Pass at least one level or omit the prop for the default View / Edit / Manage set.",
      );
    }
  }

  const existingUserIds = () =>
    entries()
      .filter((e) => e.principal.type === "user")
      .map((e) => (e.principal as { type: "user"; userId: string }).userId);
  const existingGroupIds = () =>
    entries()
      .filter((e) => e.principal.type === "group")
      .map((e) => (e.principal as { type: "group"; groupId: string }).groupId);
  const existingServiceAccountIds = () =>
    entries()
      .filter((e) => e.principal.type === "service_account")
      .map((e) => (e.principal as { type: "service_account"; serviceAccountId: string }).serviceAccountId);
  const hasAuthenticatedEntry = () => entries().some((entry) => entry.principal.type === "authenticated");
  const hasPublicEntry = () => entries().some((entry) => entry.principal.type === "public");

  const grantMut = mutation.create({
    mutation: async (data: { principal: Principal; permission: GrantableLevel }) => props.grantAccess(data.principal, data.permission),
    onSuccess: (newEntry) => {
      setEntries([...entries(), newEntry as AccessEntry]);
    },
    onError: (err) => prompts.error(err.message),
  });

  const updateMut = mutation.create<{ accessId: string; permission: GrantableLevel }, { accessId: string; permission: GrantableLevel }>({
    mutation: async (data) => {
      await props.updateAccess(data.accessId, data.permission);
      return data;
    },
    onSuccess: (result) => {
      if (result) {
        setEntries(entries().map((e) => (e.id === result.accessId ? { ...e, permission: result.permission } : e)));
      }
    },
    onError: (err) => prompts.error(err.message),
  });

  const revokeMut = mutation.create<void, string>({
    mutation: async (accessId: string) => {
      await props.revokeAccess(accessId);
    },
    onError: (err) => prompts.error(err.message),
  });

  const handleRevoke = async (entry: AccessEntry) => {
    const displayName = getEntryDisplayName(entry);
    const confirmed = await prompts.confirm(`Remove access for ${displayName}?`, { title: "Remove Access", variant: "danger" });
    if (confirmed) {
      revokeMut.mutate(entry.id);
      setEntries(entries().filter((e) => e.id !== entry.id));
    }
  };

  // ── Combobox add-flow ─────────────────────────────────────────────────
  // The Combobox is a fire-and-forget input: type → pick → granted at the
  // lowest allowed level. The `principalsByOptId` map carries the original
  // discriminated principal across the ComboboxOption boundary so onSelect
  // can route it to grantAccess without re-parsing prefixed ids.
  let principalsByOptId = new Map<string, Principal>();

  const fetchPrincipals = async (q: string, signal: AbortSignal): Promise<ComboboxOption[]> => {
    const map = new Map<string, Principal>();
    const opts: ComboboxOption[] = [];

    // Synthetic principals — only when allowed AND not already granted.
    // Placed first so they're visible immediately on focus, before any
    // typing kicks off a backend request.
    if (!hasAuthenticatedEntry()) {
      map.set("auth", { type: "authenticated" });
      opts.push({
        id: "auth",
        label: "All users (incl. guests)",
        description: "Anyone signed in to the cloud",
        icon: "ti-lock-open-2",
      });
    }
    if (allowPublic() && !hasPublicEntry()) {
      map.set("public", { type: "public" });
      opts.push({
        id: "public",
        label: "Public",
        description: "Anyone with the link, even unauthenticated",
        icon: "ti-world",
      });
    }

    // Real entities require a query — avoid a wide listing on every focus.
    if (q.length >= 2) {
      const url = new URL("/api/accounts/entities", window.location.origin);
      url.searchParams.set("search", q);
      url.searchParams.set("kinds", props.allowServiceAccounts ? "user,group,service_account" : "user,group");
      url.searchParams.set("per_page", "10");
      const userIds = existingUserIds();
      if (userIds.length) url.searchParams.set("exclude_user_ids", userIds.join(","));
      const groupIds = existingGroupIds();
      if (groupIds.length) url.searchParams.set("exclude_group_ids", groupIds.join(","));
      const serviceAccountIds = existingServiceAccountIds();
      if (serviceAccountIds.length) url.searchParams.set("exclude_service_account_ids", serviceAccountIds.join(","));

      const res = await fetch(url.toString(), { credentials: "same-origin", signal });
      if (res.ok) {
        const data = (await res.json()) as { items?: ApiEntity[] };
        for (const item of data.items ?? []) {
          if (item.kind === "user") {
            const id = `u:${item.user.id}`;
            map.set(id, { type: "user", userId: item.user.id });
            opts.push({
              id,
              label: item.user.displayName,
              description: item.user.mail ?? item.user.uid,
              icon: "ti-user",
            });
          } else if (item.kind === "group") {
            const id = `g:${item.group.id}`;
            map.set(id, { type: "group", groupId: item.group.id });
            opts.push({
              id,
              label: item.group.name,
              description: item.group.description ?? undefined,
              icon: "ti-users-group",
            });
          } else if (item.kind === "service_account") {
            const id = `sa:${item.serviceAccount.id}`;
            map.set(id, { type: "service_account", serviceAccountId: item.serviceAccount.id });
            opts.push({
              id,
              label: item.serviceAccount.name,
              description:
                item.serviceAccount.kind === "user_delegated"
                  ? "User-bound service account"
                  : [item.serviceAccount.appId, item.serviceAccount.resourceType, item.serviceAccount.resourceId]
                      .filter(Boolean)
                      .join(" · "),
              icon: "ti-key",
            });
          }
        }
      }
    }

    principalsByOptId = map;
    return opts;
  };

  const handleSelect = (option: ComboboxOption) => {
    const principal = principalsByOptId.get(option.id);
    if (!principal) return;
    const firstLevel = allowed()[0]?.level;
    if (!firstLevel) return; // dev-warned above; bail silently
    grantMut.mutate({ principal, permission: firstLevel });
  };

  return (
    <div class="flex flex-col gap-3">
      {/* Existing entries */}
      <div class="flex flex-col gap-1">
        <For each={entries()}>
          {(entry) => (
            <AccessEntryRow
              entry={entry}
              canEdit={canEdit()}
              allowed={allowed()}
              singlePicker={isSinglePicker()}
              onUpdatePermission={(permission) => updateMut.mutate({ accessId: entry.id, permission })}
              onRevoke={() => handleRevoke(entry)}
            />
          )}
        </For>
        <Show when={entries().length === 0}>
          <Placeholder align="left" class="px-1 py-2">
            No direct grants yet.
          </Placeholder>
        </Show>
      </div>

      {/* Add access — single Combobox, granted at the lowest allowed
          level on pick. The user upgrades via the row pill if they want
          a higher level. KISS: one decision per step. */}
      <Show when={canEdit()}>
        <Combobox
          placeholder={props.allowServiceAccounts ? "Add user, group, service account or audience..." : "Add user, group or audience..."}
          fetchData={fetchPrincipals}
          onSelect={handleSelect}
          disabled={grantMut.loading()}
        />
      </Show>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Access Entry Row
// ─────────────────────────────────────────────────────────────────────────

function AccessEntryRow(props: {
  entry: AccessEntry;
  canEdit: boolean;
  allowed: ResolvedLevel[];
  /** When true the per-row picker collapses to a non-interactive badge
   *  (single-level mode — there's nothing to switch to). */
  singlePicker: boolean;
  onUpdatePermission: (permission: GrantableLevel) => void;
  onRevoke: () => void;
}) {
  const display = () => resolveEntryDisplay(props.entry.permission, props.allowed);
  const isInteractive = () => props.canEdit && !props.singlePicker;

  const badgeClass = () => `flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border ${getPermissionColor(props.entry.permission)}`;
  const badgeBorderList = () => ({
    "border-blue-200 dark:border-blue-900": props.entry.permission === "read",
    "border-amber-200 dark:border-amber-900": props.entry.permission === "write",
    "border-purple-200 dark:border-purple-900": props.entry.permission === "admin",
    "border-zinc-200 dark:border-zinc-700":
      props.entry.permission !== "read" && props.entry.permission !== "write" && props.entry.permission !== "admin",
  });

  const badgeContent = (
    <>
      <i class={`ti ${display().icon}`} />
      <span>{display().label}</span>
      <Show when={isInteractive()}>
        <i class="ti ti-chevron-down text-[10px]" />
      </Show>
    </>
  );

  return (
    <div class="flex items-center gap-2 py-1.5">
      <Show
        when={props.entry.principal.type === "user"}
        fallback={
          <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
            <i class={`ti ${getPrincipalIcon(props.entry.principal)} text-sm`} />
          </div>
        }
      >
        <Avatar
          username={getEntryDisplayName(props.entry)}
          userId={props.entry.principal.type === "user" ? props.entry.principal.userId : undefined}
          avatarHash={props.entry.avatarHash}
          size="xs"
          class="h-7 w-7"
        />
      </Show>

      {/* Display name */}
      <div class="min-w-0 flex-1">
        <span class="truncate text-sm">{getEntryDisplayName(props.entry)}</span>
        <Show when={props.entry.principal.type === "public"}>
          <span class="ml-1 text-xs text-dimmed">(Anyone with the link)</span>
        </Show>
      </div>

      {/* Permission badge — interactive Dropdown when editable, plain
          span otherwise. */}
      <Show
        when={isInteractive()}
        fallback={
          <span class={`${badgeClass()} cursor-default`} classList={badgeBorderList()}>
            {badgeContent}
          </span>
        }
      >
        <Dropdown
          trigger={
            <button
              type="button"
              class={`${badgeClass()} cursor-pointer transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800`}
              classList={badgeBorderList()}
            >
              {badgeContent}
            </button>
          }
          position="bottom-left"
          width="10rem"
          // Custom `element` items rather than action items — lets us
          // color-tint each row by its level (matching the row pill
          // colors), prefix icons correctly with the `ti ` base class
          // (Dropdown's action.icon expected the full class but we
          // store just `ti-eye` etc.), and mark the currently-active
          // level with a checkmark.
          elements={props.allowed.map((option) => ({
            element: (close) => {
              const isCurrent = () => option.level === props.entry.permission;
              return (
                <button
                  type="button"
                  onClick={() => {
                    if (!isCurrent()) props.onUpdatePermission(option.level);
                    close();
                  }}
                  class="flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  classList={{ "bg-zinc-50 dark:bg-zinc-700/50": isCurrent() }}
                >
                  <i class={`ti ${option.icon} ${getPermissionColor(option.level)}`} />
                  <span class="flex-1 text-left">{option.label}</span>
                  <Show when={isCurrent()}>
                    <i class="ti ti-check text-emerald-500" />
                  </Show>
                </button>
              );
            },
          }))}
        />
      </Show>

      {/* Delete button — always visible when editable, dimmed by default
          (no longer hover-only). The last entry IS deletable; parent ACL
          covers the gap. */}
      <Show when={props.canEdit}>
        <button
          type="button"
          onClick={props.onRevoke}
          aria-label={`Remove ${getEntryDisplayName(props.entry)}`}
          class="flex h-6 w-6 items-center justify-center text-zinc-400 transition-colors hover:text-red-500"
        >
          <i class="ti ti-x text-sm" />
        </button>
      </Show>
    </div>
  );
}
