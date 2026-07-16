import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import { NumberInput, PermissionEditor, Placeholder, prompts, Select, SettingsModal, TextInput, toast } from "@valentinkolb/cloud/ui";
import { navigateTo, refreshCurrentPath } from "@valentinkolb/ssr/nav";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createSignal, For, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type {
  ConfigurableFolderRole,
  ConnectionOwner,
  Mailbox,
  MailWorkflow,
  ProviderBinding,
  ProviderConnection,
  SenderIdentity,
} from "../../contracts";
import type { MailFolderView } from "../../service/messages";
import { readApiError } from "./api-response";
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
  mailbox: Mailbox;
  permission: "read" | "write" | "admin";
  currentUserId: string;
  currentUserEmail: string | null;
  accessEntries: AccessEntry[];
  connections: ProviderConnection[];
  bindings: ProviderBinding[];
  folders: MailFolderView[];
  identities: SenderIdentity[];
  workflows: MailWorkflow[];
  onClose: () => void;
}) {
  const [name, setName] = createSignal(props.mailbox.name);
  const [description, setDescription] = createSignal(props.mailbox.description ?? "");
  const [searchBackend, setSearchBackend] = createSignal<Mailbox["searchBackend"]>(props.mailbox.searchBackend);
  const initialPreferences = readMailUserPreferences(props.mailbox.id);
  const [composeFormat, setComposeFormat] = createSignal(initialPreferences.composeFormat);
  const [undoSeconds, setUndoSeconds] = createSignal(initialPreferences.undoSeconds);

  const savePreferences = mutations.create<void, void>({
    mutation: async () => {
      writeMailUserPreferences(props.mailbox.id, { composeFormat: composeFormat(), undoSeconds: undoSeconds() });
    },
    onSuccess: () => toast.success("Mail preferences saved"),
    onError: (error) => prompts.error(error.message),
  });

  const save = mutations.create<void, void>({
    mutation: async () => {
      const response = await apiClient.mailboxes[":mailboxId"].$patch({
        param: { mailboxId: props.mailbox.id },
        json: { name: name().trim(), description: description().trim() || null, searchBackend: searchBackend() },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to update mailbox"));
    },
    onSuccess: () => {
      toast.success("Mailbox settings saved");
      refreshCurrentPath();
    },
    onError: (error) => prompts.error(error.message),
  });

  const addProvider = mutations.create<{ requiresConfirmation: boolean; senderCreated: boolean } | null, void>({
    mutation: async () => {
      const values = await prompts.form({
        title: "Connect mail provider",
        icon: "ti ti-plug-connected",
        size: "large",
        fields: {
          name: {
            type: "text",
            label: "Label",
            description: "The connection name shown in this settings page.",
            required: true,
            default: props.mailbox.name,
          },
          email: { type: "text", label: "Email address", required: true, default: props.currentUserEmail ?? "" },
          username: {
            type: "text",
            label: "Username",
            description: "The login name sent to IMAP and SMTP.",
            required: true,
            default: props.currentUserEmail ?? "",
          },
          imapHost: { type: "text", label: "IMAP host", required: true, placeholder: "imap.example.com" },
          imapPort: { type: "number", label: "IMAP port", required: true, default: 993, min: 1, max: 65535 },
          imapTls: {
            type: "select",
            label: "IMAP TLS",
            default: "implicit",
            options: [
              { id: "implicit", label: "Implicit TLS" },
              { id: "starttls", label: "STARTTLS" },
            ],
          },
          smtpHost: { type: "text", label: "SMTP host", required: true, placeholder: "smtp.example.com" },
          smtpPort: { type: "number", label: "SMTP port", required: true, default: 587, min: 1, max: 65535 },
          smtpTls: {
            type: "select",
            label: "SMTP TLS",
            default: "starttls",
            options: [
              { id: "starttls", label: "STARTTLS" },
              { id: "implicit", label: "Implicit TLS" },
            ],
          },
          auth: {
            type: "select",
            label: "Authentication",
            default: "password",
            options: [
              { id: "password", label: "Password" },
              { id: "oauth2", label: "OAuth2 access token" },
            ],
          },
          secret: {
            type: "text",
            label: "Password or access token",
            description: "Encrypted after verification and never shown again.",
            password: true,
            required: true,
          },
          rootPath: { type: "text", label: "Folder root", description: "Optional IMAP root for a shared namespace or delegated folder." },
          createSender: {
            type: "boolean",
            label: "Create the default sender for this address",
            description: "Recommended for normal mailboxes. Disable only when the remote folder and sender use different accounts.",
            default: true,
          },
        },
        confirmText: "Verify and connect",
      });
      if (!values) return null;
      const owner: ConnectionOwner =
        props.mailbox.connectionPolicy === "shared_connection"
          ? { type: "mailbox", mailboxId: props.mailbox.id }
          : { type: "user", userId: props.currentUserId };
      const response = await apiClient.connections.$post({
        json: {
          owner,
          connection: {
            name: values.name,
            email: values.email,
            username: values.username,
            imap: { host: values.imapHost, port: values.imapPort, tlsMode: values.imapTls === "starttls" ? "starttls" : "implicit" },
            smtp: { host: values.smtpHost, port: values.smtpPort, tlsMode: values.smtpTls === "implicit" ? "implicit" : "starttls" },
            secret:
              values.auth === "oauth2" ? { kind: "oauth2", accessToken: values.secret } : { kind: "password", password: values.secret },
          },
        },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Provider verification failed"));
      const created = await response.json();
      const bindingResponse = await apiClient.mailboxes[":mailboxId"].bindings.$post({
        param: { mailboxId: props.mailbox.id },
        json: { connectionId: created.connection.id, rootPath: values.rootPath || null },
      });
      if (!bindingResponse.ok) throw new Error(await readApiError(bindingResponse, "Connection was stored but folder discovery failed"));
      const binding = await bindingResponse.json();
      let senderCreated = false;
      if (values.createSender && !binding.requiresConfirmation) {
        const senderResponse = await apiClient.mailboxes[":mailboxId"]["sender-identities"].default.setup.$post({
          param: { mailboxId: props.mailbox.id },
          json: { bindingId: binding.binding.id, savesSentAutomatically: false },
        });
        if (!senderResponse.ok)
          throw new Error(await readApiError(senderResponse, "Provider connected, but the default sender could not be created"));
        senderCreated = true;
      }
      return { requiresConfirmation: binding.requiresConfirmation, senderCreated };
    },
    onSuccess: (result) => {
      if (!result) return;
      if (result.requiresConfirmation) toast("Connection requires explicit scope confirmation");
      toast.success(result.senderCreated ? "Provider and default sender connected" : "Provider connected");
      refreshCurrentPath();
    },
    onError: (error) => prompts.error(error.message),
  });

  const confirmBinding = mutations.create<boolean, string>({
    mutation: async (bindingId) => {
      const confirmed = await prompts.confirm(
        "The provider scope could not be matched automatically. Confirm only after checking the account and folder root.",
        { title: "Confirm remote mailbox", confirmText: "Confirm binding" },
      );
      if (!confirmed) return false;
      const response = await apiClient.mailboxes[":mailboxId"].bindings[":bindingId"].confirm.$post({
        param: { mailboxId: props.mailbox.id, bindingId },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to confirm binding"));
      return true;
    },
    onSuccess: (confirmed) => {
      if (!confirmed) return;
      toast.success("Binding confirmed");
      refreshCurrentPath();
    },
    onError: (error) => prompts.error(error.message),
  });

  const addIdentity = mutations.create<boolean, void>({
    mutation: async () => {
      const sentFolders = props.folders.filter((folder) => folder.selectable);
      const values = await prompts.form({
        title: "Add sender identity",
        icon: "ti ti-at",
        fields: {
          displayName: { type: "text", label: "Display name", description: "The name recipients see." },
          address: {
            type: "text",
            label: "From address",
            required: true,
            default: props.connections[0]?.email ?? props.currentUserEmail ?? "",
          },
          sentFolder: {
            type: "select",
            label: "Sent folder",
            description: "Required when the provider does not save submitted mail automatically.",
            clearable: true,
            default: sentFolders.find((folder) => folder.role === "sent")?.id,
            options: sentFolders.map((folder) => ({ id: folder.id, label: folder.name, icon: "ti ti-folder" })),
          },
          isDefault: { type: "boolean", label: "Default sender", default: props.identities.length === 0 },
        },
        confirmText: "Add identity",
      });
      if (!values) return false;
      const response = await apiClient.mailboxes[":mailboxId"]["sender-identities"].$post({
        param: { mailboxId: props.mailbox.id },
        json: {
          displayName: values.displayName,
          fromAddress: values.address,
          authenticationPolicy: {
            interactive: props.mailbox.connectionPolicy === "shared_connection" ? "mailbox" : "actor",
            automation: "disabled",
          },
          sentFolderId: values.sentFolder || null,
          isDefault: values.isDefault,
        },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to add sender identity"));
      return true;
    },
    onSuccess: (created) => {
      if (!created) return;
      toast.success("Sender identity added");
      refreshCurrentPath();
    },
    onError: (error) => prompts.error(error.message),
  });

  const verifyIdentity = mutations.create<boolean, SenderIdentity>({
    mutation: async (identity) => {
      const activeBindings = props.bindings.filter((binding) => binding.state === "active");
      if (activeBindings.length === 0) throw new Error("Connect an active provider binding first.");
      const values = await prompts.form({
        title: "Verify sender identity",
        icon: "ti ti-shield-check",
        fields: {
          binding: {
            type: "select",
            label: "Provider binding",
            required: true,
            default: activeBindings[0]?.id,
            options: activeBindings.map((binding) => ({ id: binding.id, label: binding.authenticatedPrincipal ?? binding.id })),
          },
          recipient: {
            type: "text",
            label: "Verification recipient",
            description: "A real message is sent to this address.",
            required: true,
            default: props.currentUserEmail ?? identity.fromAddress,
          },
          savesSent: { type: "boolean", label: "Provider saves sent mail automatically", default: false },
        },
        confirmText: "Send verification",
      });
      if (!values) return false;
      const response = await apiClient.mailboxes[":mailboxId"]["sender-identities"][":senderIdentityId"].verify.$post({
        param: { mailboxId: props.mailbox.id, senderIdentityId: identity.id },
        json: {
          bindingId: values.binding,
          verificationRecipient: values.recipient,
          savesSentAutomatically: values.savesSent === true,
        },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Sender verification failed"));
      return true;
    },
    onSuccess: (verified) => {
      if (!verified) return;
      toast.success("Sender identity verified");
      refreshCurrentPath();
    },
    onError: (error) => prompts.error(error.message),
  });

  const updateFolderRole = mutations.create<void, { role: ConfigurableFolderRole; folderId: string }>({
    mutation: async ({ role, folderId }) => {
      const route = apiClient.mailboxes[":mailboxId"]["folder-roles"][":role"];
      const param = { mailboxId: props.mailbox.id, role };
      const response = folderId ? await route.$put({ param, json: { folderId } }) : await route.$delete({ param });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to update folder role"));
    },
    onSuccess: () => {
      toast.success("Folder role updated");
      refreshCurrentPath();
    },
    onError: (error) => prompts.error(error.message),
  });

  const deleteMailbox = mutations.create<boolean, void>({
    mutation: async () => {
      const confirmed = await prompts.confirm(
        "This removes the Cloud mirror and collaboration data. It does not delete messages from the provider.",
        { title: "Delete mailbox", confirmText: "Delete mailbox", variant: "danger" },
      );
      if (!confirmed) return false;
      const response = await apiClient.mailboxes[":mailboxId"].$delete({ param: { mailboxId: props.mailbox.id } });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to delete mailbox"));
      return true;
    },
    onSuccess: (deleted) => {
      if (deleted) navigateTo("/app/mail");
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

      {props.permission === "admin" && (
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
                description="Auto uses pg_textsearch when it is available and falls back to PostgreSQL. Matching and permissions stay identical."
                value={searchBackend}
                onChange={(value) => setSearchBackend(value as Mailbox["searchBackend"])}
                options={[
                  { id: "auto", label: "Automatic", description: "Prefer pg_textsearch when available." },
                  { id: "postgres", label: "PostgreSQL", description: "Always use native PostgreSQL ranking." },
                  { id: "pg_textsearch", label: "pg_textsearch", description: "Prefer BM25 and fall back when unavailable." },
                ]}
                icon="ti ti-search"
              />
              <div class="info-block-info text-xs">
                Connection model:{" "}
                {props.mailbox.connectionPolicy === "shared_connection" ? "Shared connection" : "Personal provider accounts"}
              </div>
              <div class="flex justify-end">
                <button type="button" class="btn-primary btn-sm" onClick={() => save.mutate()} disabled={save.loading()}>
                  <i class={`ti ${save.loading() ? "ti-loader-2 animate-spin" : "ti-device-floppy"}`} aria-hidden="true" /> Save mailbox
                </button>
              </div>
            </div>
          </SettingsModal.Tab>

          <SettingsModal.Tab
            id="connections"
            title="Connections"
            icon="ti ti-plug-connected"
            description="Encrypted, write-only credentials and verified remote folders."
          >
            <div class="flex flex-col gap-2">
              <button
                type="button"
                class="btn-primary btn-sm self-start"
                onClick={() => addProvider.mutate()}
                disabled={addProvider.loading()}
              >
                <i class="ti ti-plus" /> Connect provider
              </button>
              <Show
                when={props.connections.length > 0}
                fallback={
                  <Placeholder
                    title="No provider connection"
                    description="Connect an IMAP and SMTP provider to synchronize mail."
                    icon="ti ti-plug-off"
                  />
                }
              >
                <For each={props.connections}>
                  {(connection) => (
                    <div class="paper flex items-center gap-3 p-3">
                      <i class="ti ti-server text-lg text-dimmed" />
                      <span class="min-w-0 flex-1">
                        <span class="block truncate text-sm font-medium">{connection.name}</span>
                        <span class="block truncate text-xs text-dimmed">
                          {connection.email} · {connection.imap.host}
                        </span>
                      </span>
                      <span class="badge">{connection.status}</span>
                    </div>
                  )}
                </For>
              </Show>
              <For each={props.bindings}>
                {(binding) => (
                  <div class="paper flex items-center gap-3 p-3">
                    <i class="ti ti-folders text-lg text-dimmed" />
                    <span class="min-w-0 flex-1">
                      <span class="block text-sm font-medium">{binding.authenticatedPrincipal || "Remote mailbox"}</span>
                      <span class="block text-xs text-dimmed">{binding.state}</span>
                    </span>
                    {binding.state === "pending" && (
                      <button
                        type="button"
                        class="btn-warning btn-sm"
                        onClick={() => confirmBinding.mutate(binding.id)}
                        disabled={confirmBinding.loading()}
                      >
                        Review
                      </button>
                    )}
                  </div>
                )}
              </For>
            </div>
          </SettingsModal.Tab>

          <SettingsModal.Tab
            id="senders"
            title="Senders"
            icon="ti ti-at"
            description="From addresses verified independently per provider binding."
          >
            <div class="flex flex-col gap-2">
              <button
                type="button"
                class="btn-primary btn-sm self-start"
                onClick={() => addIdentity.mutate()}
                disabled={addIdentity.loading()}
              >
                <i class="ti ti-plus" /> Add sender
              </button>
              <For each={props.identities}>
                {(identity) => (
                  <div class="paper flex items-center gap-3 p-3">
                    <i class="ti ti-user-circle text-lg text-dimmed" />
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-sm font-medium">{identity.displayName || identity.fromAddress}</span>
                      <span class="block truncate text-xs text-dimmed">{identity.fromAddress}</span>
                    </span>
                    <span class="badge">{identity.status}</span>
                    {identity.status !== "verified" && (
                      <button
                        type="button"
                        class="btn-secondary btn-sm"
                        onClick={() => verifyIdentity.mutate(identity)}
                        disabled={verifyIdentity.loading()}
                      >
                        Verify
                      </button>
                    )}
                  </div>
                )}
              </For>
            </div>
          </SettingsModal.Tab>

          <SettingsModal.Tab id="folders" title="Folders" icon="ti ti-folders" description="Map provider folders to portable Mail actions.">
            <div class="flex flex-col gap-3">
              <div class="info-block-info text-xs">
                Inbox is discovered from the provider. These mappings control sent mail, drafts, archive, trash, and junk actions.
              </div>
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
                      options={props.folders
                        .filter((folder) => folder.selectable && folder.discoveryState === "active")
                        .map((folder) => ({
                          id: folder.id,
                          label: folder.name,
                          description: folder.namespaceKinds.join(", "),
                          icon: "ti ti-folder",
                        }))}
                      clearable
                      disabled={updateFolderRole.loading()}
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
            <MailWorkflowSettings mailboxId={props.mailbox.id} initialWorkflows={props.workflows} />
          </SettingsModal.Tab>

          <SettingsModal.Tab
            id="access"
            title="Access"
            icon="ti ti-shield"
            description="Read can view and comment; write can operate mail; admin configures the mailbox."
          >
            <PermissionEditor
              initialEntries={props.accessEntries.filter((entry) => entry.principal.type !== "service_account")}
              canEdit
              grantAccess={async (principal, permission) => {
                const response = await apiClient.mailboxes[":mailboxId"].access.$post({
                  param: { mailboxId: props.mailbox.id },
                  json: { principal, permission },
                });
                if (!response.ok) throw new Error(await readApiError(response, "Failed to grant access"));
                return await response.json();
              }}
              updateAccess={async (accessId, permission) => {
                const response = await apiClient.mailboxes[":mailboxId"].access[":accessId"].$patch({
                  param: { mailboxId: props.mailbox.id, accessId },
                  json: { permission },
                });
                if (!response.ok) throw new Error(await readApiError(response, "Failed to update access"));
              }}
              revokeAccess={async (accessId) => {
                const response = await apiClient.mailboxes[":mailboxId"].access[":accessId"].$delete({
                  param: { mailboxId: props.mailbox.id, accessId },
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
