import {
  Dropdown,
  dialogCore,
  PanelDialog,
  Placeholder,
  panelDialogOptions,
  prompts,
  Select,
  Switch,
  TextInput,
  toast,
} from "@valentinkolb/cloud/ui";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type { ConfigurableFolderRole, MailCommand } from "../../contracts";
import type { MailAdminFolderView } from "../../service/folders";
import { readApiError } from "./api-response";
import { buildMailFolderTree, flattenMailFolderTree } from "./mail-folder-tree";

const FOLDER_ROLES: Array<{ id: ConfigurableFolderRole; label: string; icon: string }> = [
  { id: "sent", label: "Sent", icon: "ti ti-send" },
  { id: "drafts", label: "Drafts", icon: "ti ti-file-pencil" },
  { id: "archive", label: "Archive", icon: "ti ti-archive" },
  { id: "trash", label: "Trash", icon: "ti ti-trash" },
  { id: "junk", label: "Junk", icon: "ti ti-alert-octagon" },
];

type FolderSelectOption = {
  id: string;
  label: string;
  description: string;
  icon: string;
};

const TOP_LEVEL_FOLDER_ID = "__top_level__";
const terminalCommandStates = new Set(["confirmed", "reconciled", "failed", "cancelled", "ambiguous", "needs_attention"]);
const folderEditorDialogOptions = {
  ...panelDialogOptions,
  panelClassName: panelDialogOptions.panelClassName.replace("w-[min(96vw,48rem)]", "w-[min(94vw,36rem)]"),
};

const filterFolderOptions = (options: FolderSelectOption[], query: string, signal: AbortSignal): FolderSelectOption[] => {
  if (signal.aborted) return [];
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return options;
  return options.filter((option) => `${option.label} ${option.description}`.toLocaleLowerCase().includes(normalized));
};

const wait = (milliseconds: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });

const waitForFolderCommand = async (mailboxId: string, command: MailCommand, signal: AbortSignal): Promise<MailCommand> => {
  let current = command;
  for (let attempt = 0; attempt < 90 && !terminalCommandStates.has(current.state); attempt += 1) {
    await wait(Math.min(1_000, 200 + attempt * 50), signal);
    const response = await apiClient.mailboxes[":mailboxId"].commands[":commandId"].$get(
      { param: { mailboxId, commandId: command.id } },
      { init: { signal } },
    );
    if (!response.ok) throw new Error(await readApiError(response, "Could not verify the folder operation"));
    current = await response.json();
  }
  if (!terminalCommandStates.has(current.state)) {
    throw new Error("The provider is still processing this folder operation. Check the folder status again shortly.");
  }
  if (current.state !== "confirmed" && current.state !== "reconciled") {
    throw new Error(current.lastError || "The provider could not complete the folder operation.");
  }
  return current;
};

const runFolderCommand = async (
  mailboxId: string,
  input:
    | { kind: "create_folder"; parentFolderId: string | null; name: string; subscribe: boolean; showInSidebar: boolean }
    | { kind: "rename_folder"; folderId: string; name: string }
    | { kind: "delete_folder"; folderId: string }
    | { kind: "set_folder_subscription"; folderId: string; subscribed: boolean },
  signal: AbortSignal,
): Promise<MailCommand> => {
  const response = await apiClient.mailboxes[":mailboxId"].commands.$post({
    param: { mailboxId },
    json: { ...input, idempotencyKey: crypto.randomUUID() },
  });
  if (!response.ok) throw new Error(await readApiError(response, "Could not start the folder operation"));
  return waitForFolderCommand(mailboxId, await response.json(), signal);
};

function FolderEditor(props: {
  mailboxId: string;
  folders: MailAdminFolderView[];
  parentFolderId: string | null;
  folder: MailAdminFolderView | null;
  close: () => void;
  onSaved: () => Promise<void>;
}) {
  const create = () => props.folder === null;
  const [name, setName] = createSignal(props.folder?.name ?? "");
  const [parentFolderId, setParentFolderId] = createSignal(props.parentFolderId);
  const [showInSidebar, setShowInSidebar] = createSignal(true);
  const [subscribe, setSubscribe] = createSignal(true);
  const parentOptions = createMemo<FolderSelectOption[]>(() => [
    {
      id: TOP_LEVEL_FOLDER_ID,
      label: "Top level",
      description: "Create alongside the mailbox's top-level folders.",
      icon: "ti ti-folders",
    },
    ...flattenMailFolderTree(buildMailFolderTree(props.folders))
      .filter(({ folder }) => folder.canCreateChildren)
      .map(({ folder, depth }) => ({
        id: folder.id,
        label: `${"- ".repeat(depth)}${folder.name}`,
        description: `${folder.namespaceKinds.includes("shared") ? "Shared folder" : "Mailbox folder"}${
          folder.showInSidebar ? "" : " - hidden in sidebar"
        }`,
        icon: folder.namespaceKinds.includes("shared") ? "ti ti-users" : "ti ti-folder",
      })),
  ]);
  const selectedParentLabel = () => parentOptions().find((option) => option.id === (parentFolderId() ?? TOP_LEVEL_FOLDER_ID))?.label;
  const fetchParentOptions = async (query: string, signal: AbortSignal): Promise<FolderSelectOption[]> =>
    filterFolderOptions(parentOptions(), query, signal);
  const save = mutation.create<void, void>({
    mutation: async (_input, context) => {
      if (create()) {
        await runFolderCommand(
          props.mailboxId,
          {
            kind: "create_folder",
            parentFolderId: parentFolderId() || null,
            name: name().trim(),
            subscribe: subscribe(),
            showInSidebar: showInSidebar(),
          },
          context.abortSignal,
        );
      } else {
        await runFolderCommand(
          props.mailboxId,
          { kind: "rename_folder", folderId: props.folder!.id, name: name().trim() },
          context.abortSignal,
        );
      }
    },
    onSuccess: async () => {
      await props.onSaved();
      toast.success(create() ? "Folder created" : "Folder renamed");
      props.close();
    },
    onError: (error) => prompts.error(error.message),
  });

  return (
    <PanelDialog>
      <PanelDialog.Header
        title={create() ? "New folder" : "Rename folder"}
        subtitle={create() ? "Create a folder on the mail provider." : "Change this folder's name on the mail provider."}
        icon={create() ? "ti ti-folder-plus" : "ti ti-edit"}
        close={props.close}
      />
      <PanelDialog.Body>
        <div class="flex flex-col gap-2">
          <TextInput label="Name" value={name} onInput={setName} required />
          <Show when={create()}>
            <Select
              label="Location"
              description="Choose where the new folder belongs."
              value={() => parentFolderId() ?? TOP_LEVEL_FOLDER_ID}
              selectedLabel={selectedParentLabel}
              fetchData={fetchParentOptions}
              fetchDebounceMs={0}
              placeholder="Search folders..."
              icon="ti ti-folder"
              activeIcon="ti ti-search"
              onChange={(value) => setParentFolderId(value === TOP_LEVEL_FOLDER_ID ? null : value)}
            />
            <div class="flex flex-col gap-2 rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] px-3 py-2">
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <p class="text-sm font-medium text-primary">Show in Mail</p>
                  <p class="text-xs text-dimmed">Add the folder to this mailbox's navigation.</p>
                </div>
                <Switch value={showInSidebar} onChange={setShowInSidebar} />
              </div>
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <p class="text-sm font-medium text-primary">Subscribe on provider</p>
                  <p class="text-xs text-dimmed">Keep the folder in the provider's subscribed folder list.</p>
                </div>
                <Switch value={subscribe} onChange={setSubscribe} />
              </div>
            </div>
          </Show>
        </div>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <button type="button" class="btn-simple btn-sm" onClick={props.close}>
          Cancel
        </button>
        <button type="button" class="btn-primary btn-sm" disabled={save.loading() || !name().trim()} onClick={() => save.mutate()}>
          <i
            class={`ti ${save.loading() ? "ti-loader-2 animate-spin" : create() ? "ti-folder-plus" : "ti-device-floppy"}`}
            aria-hidden="true"
          />
          {create() ? "Create folder" : "Save name"}
        </button>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

export default function MailFolderSettings(props: {
  mailboxId: string;
  folders: MailAdminFolderView[];
  reloading: boolean;
  onReload: () => Promise<void>;
  onWorkspaceChange: () => void;
  onFolderVisibilityChange: (folderId: string, showInSidebar: boolean) => void;
  onFolderRoleChange: (role: ConfigurableFolderRole, folderId: string) => void;
  folderRolePending: boolean;
}) {
  const [pendingFolderId, setPendingFolderId] = createSignal<string | null>(null);
  const rows = createMemo(() => flattenMailFolderTree(buildMailFolderTree(props.folders)));
  const roleFolderOptions = createMemo<FolderSelectOption[]>(() =>
    props.folders
      .filter((folder) => folder.selectable && folder.discoveryState === "active")
      .map((folder) => ({
        id: folder.id,
        label: folder.name,
        description: folder.namespaceKinds.includes("shared") ? "Shared folder" : "Mailbox folder",
        icon: "ti ti-folder",
      })),
  );
  const fetchRoleFolderOptions = async (query: string, signal: AbortSignal): Promise<FolderSelectOption[]> =>
    filterFolderOptions(roleFolderOptions(), query, signal);
  const refresh = async () => {
    await props.onReload();
    props.onWorkspaceChange();
  };
  const openFolderEditor = (folder: MailAdminFolderView | null, parentFolderId: string | null = null) =>
    dialogCore.open<void>(
      (close) => (
        <FolderEditor
          mailboxId={props.mailboxId}
          folders={props.folders}
          folder={folder}
          parentFolderId={parentFolderId}
          close={() => close()}
          onSaved={refresh}
        />
      ),
      folderEditorDialogOptions,
    );

  const updateVisibility = mutation.create<{ folderId: string; showInSidebar: boolean }, { folderId: string; showInSidebar: boolean }>({
    mutation: async (input) => {
      setPendingFolderId(input.folderId);
      try {
        const response = await apiClient.mailboxes[":mailboxId"].folders[":folderId"].$patch({
          param: { mailboxId: props.mailboxId, folderId: input.folderId },
          json: { showInSidebar: input.showInSidebar },
        });
        if (!response.ok) throw new Error(await readApiError(response, "Could not update folder visibility"));
        return response.json();
      } finally {
        setPendingFolderId(null);
      }
    },
    onSuccess: ({ folderId, showInSidebar }) => {
      props.onFolderVisibilityChange(folderId, showInSidebar);
      props.onWorkspaceChange();
    },
    onError: (error) => prompts.error(error.message),
  });

  const providerMutation = mutation.create<
    { changed: boolean; action: "subscription" | "delete" },
    { folder: MailAdminFolderView; action: "subscription" | "delete" }
  >({
    mutation: async ({ folder, action }, context) => {
      setPendingFolderId(folder.id);
      try {
        if (action === "subscription") {
          await runFolderCommand(
            props.mailboxId,
            { kind: "set_folder_subscription", folderId: folder.id, subscribed: folder.subscribed !== true },
            context.abortSignal,
          );
          return { changed: true, action };
        }
        const confirmed = await prompts.confirm(
          "Only an empty folder without subfolders can be deleted. This removes it from the mail provider for everyone who can access it.",
          { title: `Delete ${folder.name}?`, confirmText: "Delete folder", variant: "danger" },
        );
        if (!confirmed) return { changed: false, action };
        await runFolderCommand(props.mailboxId, { kind: "delete_folder", folderId: folder.id }, context.abortSignal);
        return { changed: true, action };
      } finally {
        setPendingFolderId(null);
      }
    },
    onSuccess: async ({ changed, action }) => {
      if (!changed) return;
      await refresh();
      toast.success(action === "delete" ? "Folder deleted" : "Provider subscription updated");
    },
    onError: (error) => prompts.error(error.message),
  });

  const busy = () => props.reloading || pendingFolderId() !== null;

  return (
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between gap-3">
        <p class="text-xs text-dimmed">
          Choose what appears in Mail. Provider subscriptions are managed separately from sidebar visibility.
        </p>
        <button type="button" class="btn-primary btn-sm shrink-0" disabled={busy()} onClick={() => void openFolderEditor(null)}>
          <i class="ti ti-folder-plus" aria-hidden="true" />
          New folder
        </button>
      </div>

      <div class="flex flex-col gap-1">
        <Show
          when={rows().length > 0}
          fallback={
            <Placeholder icon="ti ti-folder-off" title="No folders discovered" description="Connect and rediscover the mailbox first." />
          }
        >
          <For each={rows()}>
            {({ folder, depth }) => {
              const shared = () => folder.namespaceKinds.some((kind) => kind === "shared" || kind === "other_users");
              const menuItems = () => [
                ...(folder.canCreateChildren
                  ? [{ label: "New subfolder", icon: "ti ti-folder-plus", action: () => void openFolderEditor(null, folder.id) }]
                  : []),
                ...(folder.canRename ? [{ label: "Rename", icon: "ti ti-edit", action: () => void openFolderEditor(folder) }] : []),
                ...(folder.canManageSubscription
                  ? [
                      {
                        label: folder.subscribed ? "Unsubscribe on provider" : "Subscribe on provider",
                        icon: folder.subscribed ? "ti ti-bookmark-off" : "ti ti-bookmark",
                        action: () => providerMutation.mutate({ folder, action: "subscription" }),
                      },
                    ]
                  : []),
                ...(folder.canDelete
                  ? [
                      {
                        label: "Delete folder",
                        icon: "ti ti-trash",
                        variant: "danger" as const,
                        action: () => providerMutation.mutate({ folder, action: "delete" }),
                      },
                    ]
                  : []),
              ];
              return (
                <div class="group flex min-h-12 items-center gap-3 rounded-[var(--ui-radius-control)] px-2 py-2 hover:bg-[var(--ui-hover)]">
                  <span class="flex min-w-0 flex-1 items-center gap-2" style={{ "padding-left": `${depth * 16}px` }}>
                    <i class={`ti ${folder.selectable ? "ti-folder" : "ti-folders"} shrink-0 text-secondary`} aria-hidden="true" />
                    <span class="min-w-0">
                      <span class="block truncate text-sm font-medium text-primary">{folder.name}</span>
                      <span class="flex flex-wrap items-center gap-1 text-xs text-dimmed">
                        <Show when={shared()}>
                          <span>Shared by provider</span>
                        </Show>
                        <Show when={folder.discoveryState !== "active"}>
                          <span>{folder.discoveryState === "missing" ? "Unavailable" : "Needs review"}</span>
                        </Show>
                        <Show when={folder.subscribed === false}>
                          <span>Not subscribed</span>
                        </Show>
                        <Show when={!folder.selectable}>
                          <span>Folder group</span>
                        </Show>
                      </span>
                    </span>
                  </span>
                  <div class="flex shrink-0 items-center gap-2">
                    <span class="hidden text-xs text-dimmed sm:inline">{folder.showInSidebar ? "Visible" : "Hidden"}</span>
                    <Switch
                      value={() => folder.showInSidebar}
                      disabled={busy()}
                      onChange={(showInSidebar) => updateVisibility.mutate({ folderId: folder.id, showInSidebar })}
                    />
                  </div>
                  <Show when={menuItems().length > 0}>
                    <Dropdown
                      trigger={
                        <button type="button" class="icon-btn" disabled={busy()} aria-label={`Actions for ${folder.name}`}>
                          <i
                            class={busy() && pendingFolderId() === folder.id ? "ti ti-loader-2 animate-spin" : "ti ti-dots"}
                            aria-hidden="true"
                          />
                        </button>
                      }
                      elements={menuItems()}
                      position="bottom-left"
                    />
                  </Show>
                </div>
              );
            }}
          </For>
        </Show>
      </div>

      <details class="group rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)]">
        <summary class="focus-ui flex cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--ui-radius-control)] px-3 py-2.5 text-sm font-medium text-primary">
          <span class="flex min-w-0 items-center gap-2">
            <i class="ti ti-folders text-secondary" aria-hidden="true" />
            Special folder mappings
          </span>
          <i class="ti ti-chevron-down text-secondary transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div class="flex flex-col gap-2 px-3 pb-3">
          <p class="text-xs text-dimmed">Choose where Mail stores sent messages, drafts, archived mail, trash, and junk.</p>
          <For each={FOLDER_ROLES}>
            {(role) => {
              const current = () => props.folders.find((folder) => folder.configuredRole === role.id || folder.role === role.id);
              return (
                <Select
                  label={role.label}
                  description={`Provider folder used for ${role.label.toLowerCase()} operations.`}
                  icon={role.icon}
                  value={() => current()?.id}
                  selectedLabel={() => current()?.name}
                  fetchData={fetchRoleFolderOptions}
                  fetchDebounceMs={0}
                  placeholder={`Search ${role.label.toLowerCase()} folders...`}
                  activeIcon="ti ti-search"
                  clearable
                  disabled={props.folderRolePending || busy()}
                  onChange={(folderId) => props.onFolderRoleChange(role.id, folderId)}
                />
              );
            }}
          </For>
        </div>
      </details>
    </div>
  );
}
