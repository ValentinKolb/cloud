import { createSignal, For, Show } from "solid-js";

import { prompts } from "../prompts";
import { mutation } from "@valentinkolb/stdlib/solid";
import SegmentedControl from "../input/SegmentedControl";
import EntitySearch, { type EntitySearchResult } from "./EntitySearch";
import type {
  AccessEntry,
  PermissionLevel,
  Principal,
} from "../../contracts/shared";

const PERMISSION_OPTIONS: {
  value: PermissionLevel;
  label: string;
  icon: string;
}[] = [
  { value: "read", label: "Read", icon: "ti-eye" },
  { value: "write", label: "Write", icon: "ti-pencil" },
  { value: "admin", label: "Admin", icon: "ti-shield" },
];

type PermissionEditorProps = {
  /** Resource ID (e.g., space ID) */
  resourceId: string;
  /** Initial access entries */
  initialEntries: AccessEntry[];
  /** Whether the current user can edit permissions */
  canEdit?: boolean;
  /** Grant access for this resource */
  grantAccess: (
    resourceId: string,
    principal: Principal,
    permission: PermissionLevel
  ) => Promise<AccessEntry>;
  /** Update access permission for this resource */
  updateAccess: (
    resourceId: string,
    accessId: string,
    permission: PermissionLevel
  ) => Promise<void>;
  /** Revoke access for this resource */
  revokeAccess: (resourceId: string, accessId: string) => Promise<void>;
  /** Allow creating public access entries from this editor */
  allowPublic?: boolean;
  /**
   * Restrict which permission levels the editor offers. Default = all
   * three (read / write / admin). When set to a subset:
   * - the dropdown on existing rows + the SegmentedControl on the add
   *   form filter to the allowed values
   * - when exactly ONE level is allowed, both controls vanish entirely
   *   (a one-option picker is just noise) and the level renders as a
   *   plain inline badge instead. Use cases: views accept only `read`,
   *   forms only `write`.
   */
  allowedLevels?: PermissionLevel[];
};

/**
 * Permission Editor component for managing access control.
 * Can be used in dialogs or pages to manage who has access to a resource.
 */
export default function PermissionEditor(props: PermissionEditorProps) {
  const [entries, setEntries] = createSignal<AccessEntry[]>([
    ...props.initialEntries,
  ]);
  const [showAddForm, setShowAddForm] = createSignal(false);
  const canEdit = () => props.canEdit !== false;
  const allowPublic = () => props.allowPublic === true;
  // Resolve the level whitelist once. Falls back to all-three so the
  // existing 40+ call-sites that don't pass `allowedLevels` keep
  // exactly today's behaviour.
  const allowedLevels = (): PermissionLevel[] =>
    props.allowedLevels && props.allowedLevels.length > 0
      ? props.allowedLevels
      : (PERMISSION_OPTIONS.map((o) => o.value) as PermissionLevel[]);

  // Get existing user IDs and group IDs to exclude from search
  const existingUserIds = () =>
    entries()
      .filter((e) => e.principal.type === "user")
      .map((e) => (e.principal as { type: "user"; userId: string }).userId);

  const existingGroupIds = () =>
    entries()
      .filter((e) => e.principal.type === "group")
      .map((e) => (e.principal as { type: "group"; groupId: string }).groupId);

  const hasAuthenticatedEntry = () =>
    entries().some((entry) => entry.principal.type === "authenticated");
  const hasPublicEntry = () =>
    entries().some((entry) => entry.principal.type === "public");

  // Grant access mutation
  const grantMut = mutation.create({
    mutation: async (data: {
      principal: Principal;
      permission: PermissionLevel;
    }) => {
      return props.grantAccess(
        props.resourceId,
        data.principal,
        data.permission
      );
    },
    onSuccess: (newEntry) => {
      setEntries([...entries(), newEntry as AccessEntry]);
      setShowAddForm(false);
    },
    onError: (err) => prompts.error(err.message),
  });

  // Update permission mutation
  const updateMut = mutation.create<
    { accessId: string; permission: PermissionLevel },
    { accessId: string; permission: PermissionLevel }
  >({
    mutation: async (data) => {
      await props.updateAccess(
        props.resourceId,
        data.accessId,
        data.permission
      );
      // Return the data so we can use it in onSuccess
      return data;
    },
    onSuccess: (result) => {
      if (result) {
        setEntries(
          entries().map((e) =>
            e.id === result.accessId
              ? { ...e, permission: result.permission }
              : e
          )
        );
      }
    },
    onError: (err) => prompts.error(err.message),
  });

  // Revoke access mutation
  const revokeMut = mutation.create<void, string>({
    mutation: async (accessId: string) => {
      await props.revokeAccess(props.resourceId, accessId);
    },
    onError: (err) => prompts.error(err.message),
  });

  const handleRevoke = async (entry: AccessEntry) => {
    if (entries().length <= 1) {
      prompts.error("Cannot remove the last access entry");
      return;
    }

    const displayName = getEntryDisplayName(entry);
    const confirmed = await prompts.confirm(
      `Remove access for ${displayName}?`,
      { title: "Remove Access", variant: "danger" }
    );
    if (confirmed) {
      revokeMut.mutate(entry.id);
      setEntries(entries().filter((e) => e.id !== entry.id));
    }
  };

  const handleEntitySelect = (
    result: EntitySearchResult,
    permission: PermissionLevel
  ) => {
    const principal: Principal =
      result.type === "user"
        ? { type: "user", userId: result.id }
        : { type: "group", groupId: result.id };

    grantMut.mutate({ principal, permission });
  };

  return (
    <div class="flex flex-col gap-3">
      {/* Existing entries */}
      <div class="flex flex-col border-l-2 border-zinc-200 dark:border-zinc-700">
        <For each={entries()}>
          {(entry) => (
            <AccessEntryRow
              entry={entry}
              canEdit={canEdit()}
              canDelete={entries().length > 1}
              allowedLevels={allowedLevels()}
              onUpdatePermission={(permission) =>
                updateMut.mutate({ accessId: entry.id, permission })
              }
              onRevoke={() => handleRevoke(entry)}
              updating={updateMut.loading()}
            />
          )}
        </For>
      </div>

      {/* Add access */}
      <Show when={canEdit()}>
        <Show
          when={showAddForm()}
          fallback={
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              class="flex items-center gap-2 text-sm text-dimmed hover:text-primary transition-colors"
            >
              <i class="ti ti-plus" />
              <span>Add access</span>
            </button>
          }
        >
          <AddAccessForm
            existingUserIds={existingUserIds()}
            existingGroupIds={existingGroupIds()}
            allowedLevels={allowedLevels()}
            onSelectEntity={handleEntitySelect}
            onSelectPrincipal={(principal, permission) =>
              grantMut.mutate({ principal, permission })
            }
            onCancel={() => setShowAddForm(false)}
            loading={grantMut.loading()}
            showAuthenticated={!hasAuthenticatedEntry()}
            showPublic={allowPublic() && !hasPublicEntry()}
          />
        </Show>
      </Show>
    </div>
  );
}

// =============================================================================
// Helper Functions
// =============================================================================

function getEntryDisplayName(entry: AccessEntry): string {
  if (entry.displayName) return entry.displayName;
  if (entry.principal.type === "authenticated")
    return "All users (incl. guests)";
  if (entry.principal.type === "public") return "Public";
  if (entry.principal.type === "user") return entry.principal.userId;
  return entry.principal.groupId;
}

function getPrincipalIcon(principal: Principal): string {
  switch (principal.type) {
    case "user":
      return "ti-user";
    case "group":
      return "ti-users-group";
    case "authenticated":
      return "ti-lock-open-2";
    case "public":
      return "ti-world";
  }
}

function getPermissionColor(level: PermissionLevel): string {
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
}

// =============================================================================
// Access Entry Row
// =============================================================================

function AccessEntryRow(props: {
  entry: AccessEntry;
  canEdit: boolean;
  canDelete: boolean;
  allowedLevels: PermissionLevel[];
  onUpdatePermission: (permission: PermissionLevel) => void;
  onRevoke: () => void;
  updating: boolean;
}) {
  const [showPermissionMenu, setShowPermissionMenu] = createSignal(false);

  // Single-allowed-level → the badge is purely informational. No
  // chevron, no dropdown, no hover affordance, not even a button —
  // there's nothing to switch to. Keeps the row visually quiet for
  // surfaces like view-edit (read-only) or form-write (submit-only).
  const isSinglePicker = () => props.allowedLevels.length === 1;
  const allowedOptions = () =>
    PERMISSION_OPTIONS.filter((o) => props.allowedLevels.includes(o.value));
  const isInteractive = () => props.canEdit && !isSinglePicker();

  // Wrap the badge in a button only when interactive — a non-button
  // <span> reads correctly to screen readers when there's no action.
  const badgeContent = (
    <>
      <i
        class={`ti ${
          PERMISSION_OPTIONS.find((o) => o.value === props.entry.permission)
            ?.icon
        }`}
      />
      <span class="capitalize">{props.entry.permission}</span>
      <Show when={isInteractive()}>
        <i class="ti ti-chevron-down text-[10px]" />
      </Show>
    </>
  );
  const badgeClass = `flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border ${getPermissionColor(
    props.entry.permission,
  )}`;
  const badgeBorderList = {
    "border-blue-200 dark:border-blue-900": props.entry.permission === "read",
    "border-amber-200 dark:border-amber-900": props.entry.permission === "write",
    "border-purple-200 dark:border-purple-900": props.entry.permission === "admin",
  };

  return (
    <div class="group/entry pl-3 py-1.5 flex items-center gap-2">
      {/* Icon */}
      <div class="flex shrink-0 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 h-7 w-7">
        <i class={`ti ${getPrincipalIcon(props.entry.principal)} text-sm`} />
      </div>

      {/* Name */}
      <div class="flex-1 min-w-0">
        <span class="text-sm truncate">{getEntryDisplayName(props.entry)}</span>
        <Show when={props.entry.principal.type === "public"}>
          <span class="text-xs text-dimmed ml-1">(Anyone with the link)</span>
        </Show>
      </div>

      {/* Permission badge / selector */}
      <div class="relative">
        <Show
          when={isInteractive()}
          fallback={
            <span class={`${badgeClass} cursor-default`} classList={badgeBorderList}>
              {badgeContent}
            </span>
          }
        >
          <button
            type="button"
            onClick={() => setShowPermissionMenu(!showPermissionMenu())}
            class={`${badgeClass} cursor-pointer transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800`}
            classList={badgeBorderList}
          >
            {badgeContent}
          </button>

          {/* Permission dropdown — only the allowed options are listed,
              so a row showing `read` with allowedLevels=[read,write]
              gives the user `write` as the only switch target. */}
          <Show when={showPermissionMenu()}>
            <div class="absolute right-0 top-full mt-1 z-10 popup min-w-30">
              <For each={allowedOptions()}>
                {(option) => (
                  <button
                    type="button"
                    onClick={() => {
                      if (option.value !== props.entry.permission) {
                        props.onUpdatePermission(option.value);
                      }
                      setShowPermissionMenu(false);
                    }}
                    class="w-full px-3 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center gap-2"
                    classList={{
                      "bg-zinc-50 dark:bg-zinc-700/50":
                        option.value === props.entry.permission,
                    }}
                  >
                    <i class={`ti ${option.icon} ${getPermissionColor(option.value)}`} />
                    <span>{option.label}</span>
                    <Show when={option.value === props.entry.permission}>
                      <i class="ti ti-check ml-auto text-green-500" />
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>

      {/* Delete button */}
      <Show when={props.canEdit && props.canDelete}>
        <button
          type="button"
          onClick={props.onRevoke}
          class="p-1 w-6 h-6 flex items-center justify-center text-dimmed hover:text-red-500 opacity-0 group-hover/entry:opacity-100 transition-opacity"
        >
          <i class="ti ti-x text-sm" />
        </button>
      </Show>
    </div>
  );
}

// =============================================================================
// Add Access Form
// =============================================================================

function AddAccessForm(props: {
  existingUserIds: string[];
  existingGroupIds: string[];
  allowedLevels: PermissionLevel[];
  onSelectEntity: (
    result: EntitySearchResult,
    permission: PermissionLevel
  ) => void;
  onSelectPrincipal: (
    principal: Principal,
    permission: PermissionLevel
  ) => void;
  onCancel: () => void;
  loading: boolean;
  showAuthenticated: boolean;
  showPublic: boolean;
}) {
  // Initial permission = first allowed level. Picks "read" when all
  // three are allowed (existing default); falls to whatever single
  // value the caller restricted to (e.g. "write" for forms).
  const [permission, setPermission] = createSignal<PermissionLevel>(
    props.allowedLevels[0] ?? "read",
  );
  const hasTwoPrincipalButtons = () =>
    props.showAuthenticated && props.showPublic;
  // Filter the SegmentedControl to the allowed subset only.
  const permissionOptions = () =>
    PERMISSION_OPTIONS
      .filter((o) => props.allowedLevels.includes(o.value))
      .map((option) => ({
        value: option.value,
        label: option.label,
        icon: `ti ${option.icon}`,
      }));
  const isSinglePicker = () => props.allowedLevels.length === 1;

  return (
    <div class="paper p-3 flex flex-col gap-2">
      {/* Permission level selector — hidden when only one level is
          allowed (a one-option SegmentedControl is just visual noise;
          the level is fixed at the allowedLevels[0] default). */}
      <Show when={!isSinglePicker()}>
        <div class="flex flex-col gap-1">
          <p class="text-xs text-secondary">Permission Level</p>
          <SegmentedControl
            options={permissionOptions()}
            value={permission}
            onChange={setPermission}
            disabled={props.loading}
          />
        </div>
      </Show>

      {/* User/Group search */}
      <EntitySearch
        apiBaseUrl="/api/accounts"
        searchUsers
        searchGroups
        excludeUserIds={props.existingUserIds}
        excludeGroupIds={props.existingGroupIds}
        onSelect={(result) => props.onSelectEntity(result, permission())}
        placeholder="Search users or groups..."
        adding={props.loading}
        resultsHeightClass="max-h-36 min-h-20"
      />

      <Show when={props.showAuthenticated || props.showPublic}>
        <div
          class="grid gap-2"
          classList={{
            "grid-cols-2": hasTwoPrincipalButtons(),
            "grid-cols-1": !hasTwoPrincipalButtons(),
          }}
        >
          <Show when={props.showAuthenticated}>
            <button
              type="button"
              onClick={() =>
                props.onSelectPrincipal({ type: "authenticated" }, permission())
              }
              disabled={props.loading}
              class="btn-simple btn-sm w-full justify-center"
            >
              <i class="ti ti-lock-open-2" />
              All users (incl. guests)
            </button>
          </Show>
          <Show when={props.showPublic}>
            <button
              type="button"
              onClick={() =>
                props.onSelectPrincipal({ type: "public" }, permission())
              }
              disabled={props.loading}
              class="btn-secondary btn-sm w-full justify-center"
            >
              <i class="ti ti-world" />
              Allow public
            </button>
          </Show>
        </div>
      </Show>

      {/* Cancel button */}
      <button
        type="button"
        onClick={props.onCancel}
        class="text-xs text-dimmed hover:text-primary self-end"
      >
        Cancel
      </button>
    </div>
  );
}
