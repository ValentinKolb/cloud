import { NumberInput, PermissionEditor, prompts, Select, SettingsModal, TextInput, toast } from "@valentinkolb/cloud/ui";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createSignal, For } from "solid-js";
import { apiClient } from "../../api/client";
import type { ConfigurableFolderRole, Mailbox } from "../../contracts";
import type { MailboxSettingsContext } from "../../settings-context";
import { readApiError } from "./api-response";
import { MailConnectionSettings, MailSenderSettings } from "./MailProviderSettings";
import { readMailUserPreferences, writeMailUserPreferences } from "./MailSettingsStore";
import MailWorkflowSettings from "./MailWorkflowSettings";

const FOLDER_ROLES: Array<{ id: ConfigurableFolderRole; label: string; icon: string }> = [
  { id: "sent", label: "Sent", icon: "ti ti-send" },
  { id: "drafts", label: "Drafts", icon: "ti ti-file-pencil" },
  { id: "archive", label: "Archive", icon: "ti ti-archive" },
  { id: "trash", label: "Trash", icon: "ti ti-trash" },
  { id: "junk", label: "Junk", icon: "ti ti-alert-octagon" },
];

export default function MailboxSettings(props: {
  context: MailboxSettingsContext;
  currentUserId: string;
  currentUserEmail: string | null;
  reloading: boolean;
  onReload: () => Promise<void>;
  onContextChange: (update: (context: MailboxSettingsContext) => MailboxSettingsContext) => void;
  onWorkspaceChange: () => void;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const admin = () => props.context.admin!;
  const [name, setName] = createSignal(props.context.mailbox.name);
  const [description, setDescription] = createSignal(props.context.mailbox.description ?? "");
  const [searchBackend, setSearchBackend] = createSignal<Mailbox["searchBackend"]>(props.context.mailbox.searchBackend);
  const initialPreferences = readMailUserPreferences(props.context.mailbox.id);
  const [composeFormat, setComposeFormat] = createSignal(initialPreferences.composeFormat);
  const [undoSeconds, setUndoSeconds] = createSignal(initialPreferences.undoSeconds);

  const savePreferences = mutation.create<void, void>({
    mutation: async () => {
      writeMailUserPreferences(props.context.mailbox.id, { composeFormat: composeFormat(), undoSeconds: undoSeconds() });
    },
    onSuccess: () => toast.success("Mail preferences saved"),
    onError: (error) => prompts.error(error.message),
  });

  const saveMailbox = mutation.create<Mailbox, void>({
    mutation: async () => {
      const response = await apiClient.mailboxes[":mailboxId"].$patch({
        param: { mailboxId: props.context.mailbox.id },
        json: { name: name().trim(), description: description().trim() || null, searchBackend: searchBackend() },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to update mailbox"));
      return response.json();
    },
    onSuccess: (mailbox) => {
      setName(mailbox.name);
      setDescription(mailbox.description ?? "");
      setSearchBackend(mailbox.searchBackend);
      props.onContextChange((context) => ({ ...context, mailbox }));
      toast.success("Mailbox settings saved");
      props.onWorkspaceChange();
    },
    onError: (error) => prompts.error(error.message),
  });

  const updateFolderRole = mutation.create<
    { role: ConfigurableFolderRole; folderId: string },
    { role: ConfigurableFolderRole; folderId: string }
  >({
    mutation: async (input) => {
      const { role, folderId } = input;
      const route = apiClient.mailboxes[":mailboxId"]["folder-roles"][":role"];
      const param = { mailboxId: props.context.mailbox.id, role };
      const response = folderId ? await route.$put({ param, json: { folderId } }) : await route.$delete({ param });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to update folder role"));
      return input;
    },
    onSuccess: ({ role, folderId }) => {
      props.onContextChange((context) => ({
        ...context,
        admin: context.admin
          ? {
              ...context.admin,
              folders: context.admin.folders.map((folder) => ({
                ...folder,
                configuredRole: folder.id === folderId ? role : folder.configuredRole === role ? null : folder.configuredRole,
              })),
            }
          : null,
      }));
      toast.success("Folder role updated");
      props.onWorkspaceChange();
    },
    onError: (error) => prompts.error(error.message),
  });

  const deleteMailbox = mutation.create<boolean, void>({
    mutation: async () => {
      const confirmed = await prompts.confirm(
        "This removes the Cloud mirror and collaboration data. It does not delete messages from the provider.",
        { title: "Delete mailbox", confirmText: "Delete mailbox", variant: "danger" },
      );
      if (!confirmed) return false;
      const response = await apiClient.mailboxes[":mailboxId"].$delete({ param: { mailboxId: props.context.mailbox.id } });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to delete mailbox"));
      return true;
    },
    onSuccess: (deleted) => {
      if (deleted) props.onDeleted();
    },
    onError: (error) => prompts.error(error.message),
  });

  return (
    <SettingsModal title="Mailbox settings" onClose={props.onClose} closeLabel="Close settings">
      <SettingsModal.Tab
        id="preferences"
        title="Preferences"
        icon="ti ti-adjustments"
        description="Personal compose defaults on this device."
      >
        <div class="flex flex-col gap-3">
          <Select
            label="Compose format"
            description="Used when you open a new message, reply, or forward."
            value={composeFormat}
            onChange={(value) => setComposeFormat(value === "plain" ? "plain" : "markdown")}
            options={[
              { id: "markdown", label: "Markdown", icon: "ti ti-markdown" },
              { id: "plain", label: "Plain text", icon: "ti ti-align-left" },
            ]}
          />
          <NumberInput
            label="Undo send window"
            description="Delay delivery so you have time to cancel a queued message."
            value={undoSeconds}
            onInput={(value) => setUndoSeconds(value ?? 0)}
            min={0}
            max={60}
            allowNegative={false}
            suffix="seconds"
          />
          <button
            type="button"
            class="btn-primary btn-sm self-end"
            disabled={savePreferences.loading()}
            onClick={() => savePreferences.mutate()}
          >
            <i class={`ti ${savePreferences.loading() ? "ti-loader-2 animate-spin" : "ti-device-floppy"}`} aria-hidden="true" />
            Save preferences
          </button>
        </div>
      </SettingsModal.Tab>

      {props.context.permission === "admin" && props.context.admin && (
        <>
          <SettingsModal.Tab id="general" title="General" icon="ti ti-id" description="Mailbox identity and synchronization.">
            <div class="flex flex-col gap-3">
              <TextInput label="Name" description="The label collaborators see." value={name} onInput={setName} required />
              <TextInput
                label="Description"
                description="Optional context for this mailbox."
                value={description}
                onInput={setDescription}
                multiline
                lines={3}
              />
              <Select
                label="Search ranking"
                description="Automatic uses pg_textsearch when available and falls back to PostgreSQL. Matching and permissions stay identical."
                value={searchBackend}
                onChange={(value) => setSearchBackend(value as Mailbox["searchBackend"])}
                options={[
                  { id: "auto", label: "Automatic", description: "Prefer pg_textsearch when available." },
                  { id: "postgres", label: "PostgreSQL", description: "Always use native PostgreSQL ranking." },
                  { id: "pg_textsearch", label: "pg_textsearch", description: "Prefer BM25 and fall back when unavailable." },
                ]}
                icon="ti ti-search"
              />
              <p class="text-xs text-dimmed">
                Connection model:{" "}
                {props.context.mailbox.connectionPolicy === "shared_connection" ? "Shared connection" : "Personal provider accounts"}
              </p>
              <button
                type="button"
                class="btn-primary btn-sm self-end"
                onClick={() => saveMailbox.mutate()}
                disabled={saveMailbox.loading() || props.reloading || !name().trim()}
              >
                <i class={`ti ${saveMailbox.loading() ? "ti-loader-2 animate-spin" : "ti-device-floppy"}`} aria-hidden="true" /> Save
                mailbox
              </button>
            </div>
          </SettingsModal.Tab>

          <SettingsModal.Tab
            id="connections"
            title="Connections"
            icon="ti ti-plug-connected"
            description="Encrypted, write-only credentials and verified remote folders."
          >
            <MailConnectionSettings
              mailbox={props.context.mailbox}
              admin={admin()}
              currentUserId={props.currentUserId}
              currentUserEmail={props.currentUserEmail}
              reloading={props.reloading}
              onReload={props.onReload}
              onWorkspaceChange={props.onWorkspaceChange}
            />
          </SettingsModal.Tab>

          <SettingsModal.Tab
            id="senders"
            title="Senders"
            icon="ti ti-at"
            description="From addresses verified independently per provider binding."
          >
            <MailSenderSettings
              mailbox={props.context.mailbox}
              admin={admin()}
              currentUserId={props.currentUserId}
              currentUserEmail={props.currentUserEmail}
              reloading={props.reloading}
              onReload={props.onReload}
              onWorkspaceChange={props.onWorkspaceChange}
            />
          </SettingsModal.Tab>

          <SettingsModal.Tab id="folders" title="Folders" icon="ti ti-folders" description="Map provider folders to portable Mail actions.">
            <div class="flex flex-col gap-3">
              <p class="text-xs text-dimmed">
                Inbox is discovered from the provider. These mappings control sent mail, drafts, archive, trash, and junk actions.
              </p>
              <For each={FOLDER_ROLES}>
                {(role) => {
                  const current = () => admin().folders.find((folder) => folder.configuredRole === role.id || folder.role === role.id);
                  return (
                    <Select
                      label={role.label}
                      description={`Provider folder used for ${role.label.toLowerCase()} operations.`}
                      icon={role.icon}
                      value={() => current()?.id}
                      selectedLabel={() => current()?.name}
                      options={admin()
                        .folders.filter((folder) => folder.selectable && folder.discoveryState === "active")
                        .map((folder) => ({
                          id: folder.id,
                          label: folder.name,
                          description: folder.namespaceKinds.join(", "),
                          icon: "ti ti-folder",
                        }))}
                      clearable
                      disabled={updateFolderRole.loading() || props.reloading}
                      onChange={(folderId) => updateFolderRole.mutate({ role: role.id, folderId })}
                    />
                  );
                }}
              </For>
            </div>
          </SettingsModal.Tab>

          <SettingsModal.Tab
            id="automation"
            title="Automation"
            icon="ti ti-route"
            description="Versioned YAML workflows with explicit activation."
          >
            <MailWorkflowSettings mailboxId={props.context.mailbox.id} initialWorkflows={admin().workflows} />
          </SettingsModal.Tab>

          <SettingsModal.Tab
            id="access"
            title="Access"
            icon="ti ti-shield"
            description="Read can view and comment; write can operate mail; admin configures the mailbox."
          >
            <PermissionEditor
              initialEntries={admin().accessEntries.filter((entry) => entry.principal.type !== "service_account")}
              canEdit
              grantAccess={async (principal, permission) => {
                const response = await apiClient.mailboxes[":mailboxId"].access.$post({
                  param: { mailboxId: props.context.mailbox.id },
                  json: { principal, permission },
                });
                if (!response.ok) throw new Error(await readApiError(response, "Failed to grant access"));
                return response.json();
              }}
              updateAccess={async (accessId, permission) => {
                const response = await apiClient.mailboxes[":mailboxId"].access[":accessId"].$patch({
                  param: { mailboxId: props.context.mailbox.id, accessId },
                  json: { permission },
                });
                if (!response.ok) throw new Error(await readApiError(response, "Failed to update access"));
              }}
              revokeAccess={async (accessId) => {
                const response = await apiClient.mailboxes[":mailboxId"].access[":accessId"].$delete({
                  param: { mailboxId: props.context.mailbox.id, accessId },
                });
                if (!response.ok) throw new Error(await readApiError(response, "Failed to revoke access"));
              }}
            />
          </SettingsModal.Tab>

          <SettingsModal.Tab
            id="danger"
            title="Danger zone"
            icon="ti ti-alert-triangle"
            description="Permanently remove the Cloud mirror and collaboration data."
            tone="danger"
          >
            <div class="flex items-start justify-between gap-4">
              <div>
                <p class="text-sm font-medium text-primary">Delete mailbox</p>
                <p class="mt-1 text-xs text-dimmed">Messages remain on the provider, but Cloud data and access are removed.</p>
              </div>
              <button
                type="button"
                class="btn-danger btn-sm shrink-0"
                onClick={() => deleteMailbox.mutate()}
                disabled={deleteMailbox.loading()}
              >
                <i class={`ti ${deleteMailbox.loading() ? "ti-loader-2 animate-spin" : "ti-trash"}`} aria-hidden="true" /> Delete mailbox
              </button>
            </div>
          </SettingsModal.Tab>
        </>
      )}
    </SettingsModal>
  );
}
