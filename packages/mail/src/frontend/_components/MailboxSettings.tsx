import {
  confirmDiscardIfDirty,
  NumberInput,
  PermissionEditor,
  prompts,
  Select,
  SettingsModal,
  TextInput,
  toast,
} from "@valentinkolb/cloud/ui";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createMemo, createSignal, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type { ConfigurableFolderRole, Mailbox } from "../../contracts";
import type { MailboxSettingsContext } from "../../settings-context";
import { readApiError } from "./api-response";
import MailComposeSettings from "./MailComposeSettings";
import MailFolderSettings from "./MailFolderSettings";
import MailOrganizationSettings from "./MailOrganizationSettings";
import { MailConnectionSettings, MailIdentitySettings } from "./MailProviderSettings";
import { readMailUserPreferences, writeMailUserPreferences } from "./MailSettingsStore";

const normalizeInitialTab = (tab: string | undefined, canWrite: boolean, canAdmin: boolean): string => {
  const aliases: Record<string, string> = {
    preferences: "writing",
    compose: "writing",
    general: "mailbox",
    connections: "delivery",
    identities: "delivery",
  };
  const requested = aliases[tab ?? ""] ?? tab;
  const allowed = new Set([
    "organization",
    ...(canWrite ? ["writing"] : []),
    ...(canAdmin ? ["mailbox", "delivery", "folders", "access", "danger"] : []),
  ]);
  if (requested && allowed.has(requested)) return requested;
  return canAdmin ? "mailbox" : canWrite ? "writing" : "organization";
};

export default function MailboxSettings(props: {
  context: MailboxSettingsContext;
  initialTab?: string;
  currentUserEmail: string | null;
  reloading: boolean;
  onReload: () => Promise<void>;
  onContextChange: (update: (context: MailboxSettingsContext) => MailboxSettingsContext) => void;
  onWorkspaceChange: () => void;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const canWrite = () => props.context.permission === "write" || props.context.permission === "admin";
  const canAdmin = () => props.context.permission === "admin";
  const admin = () => props.context.admin!;
  const initialPreferences = readMailUserPreferences(props.context.mailbox.id);
  const [savedComposeFormat, setSavedComposeFormat] = createSignal(initialPreferences.composeFormat);
  const [savedUndoSeconds, setSavedUndoSeconds] = createSignal(initialPreferences.undoSeconds);
  const [composeFormat, setComposeFormat] = createSignal(initialPreferences.composeFormat);
  const [undoSeconds, setUndoSeconds] = createSignal(initialPreferences.undoSeconds);
  const [name, setName] = createSignal(props.context.mailbox.name);
  const [description, setDescription] = createSignal(props.context.mailbox.description ?? "");
  const [internalDomains, setInternalDomains] = createSignal(props.context.mailbox.composeSafety.internalDomains.join(", "));
  const [largeRecipientThreshold, setLargeRecipientThreshold] = createSignal(
    props.context.mailbox.composeSafety.largeRecipientThreshold,
  );
  const [automaticReplyManagementPermission, setAutomaticReplyManagementPermission] = createSignal<
    Mailbox["automaticReplyManagementPermission"]
  >(props.context.mailbox.automaticReplyManagementPermission);
  const [activeTab, setActiveTab] = createSignal(normalizeInitialTab(props.initialTab, canWrite(), canAdmin()));
  const [childDirtyStates, setChildDirtyStates] = createSignal<Record<string, boolean>>({});
  const [navigationPending, setNavigationPending] = createSignal(false);

  const ownDirty = createMemo(() => {
    if (activeTab() === "writing") {
      return composeFormat() !== savedComposeFormat() || undoSeconds() !== savedUndoSeconds();
    }
    if (activeTab() === "mailbox") {
      return (
        name().trim() !== props.context.mailbox.name ||
        description().trim() !== (props.context.mailbox.description ?? "") ||
        internalDomains() !== props.context.mailbox.composeSafety.internalDomains.join(", ") ||
        largeRecipientThreshold() !== props.context.mailbox.composeSafety.largeRecipientThreshold
      );
    }
    if (activeTab() === "access") {
      return automaticReplyManagementPermission() !== props.context.mailbox.automaticReplyManagementPermission;
    }
    return false;
  });
  const setChildDirty = (key: string, dirty: boolean) =>
    setChildDirtyStates((current) => (current[key] === dirty ? current : { ...current, [key]: dirty }));
  const hasUnsavedChanges = () => ownDirty() || Object.values(childDirtyStates()).some(Boolean);

  const resetActiveTab = () => {
    if (activeTab() === "writing") {
      setComposeFormat(savedComposeFormat());
      setUndoSeconds(savedUndoSeconds());
    } else if (activeTab() === "mailbox") {
      setName(props.context.mailbox.name);
      setDescription(props.context.mailbox.description ?? "");
      setInternalDomains(props.context.mailbox.composeSafety.internalDomains.join(", "));
      setLargeRecipientThreshold(props.context.mailbox.composeSafety.largeRecipientThreshold);
    } else if (activeTab() === "access") {
      setAutomaticReplyManagementPermission(props.context.mailbox.automaticReplyManagementPermission);
    }
    setChildDirtyStates({});
  };

  const requestTabChange = async (nextTab: string) => {
    if (nextTab === activeTab() || navigationPending()) return;
    setNavigationPending(true);
    try {
      if (!(await confirmDiscardIfDirty(hasUnsavedChanges))) return;
      resetActiveTab();
      setActiveTab(nextTab);
    } finally {
      setNavigationPending(false);
    }
  };

  const requestClose = async () => {
    if (navigationPending()) return;
    setNavigationPending(true);
    try {
      if (await confirmDiscardIfDirty(hasUnsavedChanges)) props.onClose();
    } finally {
      setNavigationPending(false);
    }
  };

  const savePreferences = mutation.create<void, void>({
    mutation: async () => {
      writeMailUserPreferences(props.context.mailbox.id, { composeFormat: composeFormat(), undoSeconds: undoSeconds() });
    },
    onSuccess: () => {
      setSavedComposeFormat(composeFormat());
      setSavedUndoSeconds(undoSeconds());
      toast.success("Writing preferences saved");
    },
    onError: (error) => prompts.error(error.message),
  });

  const saveMailbox = mutation.create<Mailbox, void>({
    mutation: async () => {
      const response = await apiClient.mailboxes[":mailboxId"].$patch({
        param: { mailboxId: props.context.mailbox.id },
        json: {
          name: name().trim(),
          description: description().trim() || null,
          composeSafety: {
            internalDomains: [
              ...new Set(
                internalDomains()
                  .split(/[,\s]+/u)
                  .map((domain) => domain.trim().toLowerCase())
                  .filter(Boolean),
              ),
            ],
            largeRecipientThreshold: largeRecipientThreshold(),
          },
        },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to update mailbox"));
      return response.json();
    },
    onSuccess: (mailbox) => {
      setName(mailbox.name);
      setDescription(mailbox.description ?? "");
      setInternalDomains(mailbox.composeSafety.internalDomains.join(", "));
      setLargeRecipientThreshold(mailbox.composeSafety.largeRecipientThreshold);
      props.onContextChange((context) => ({ ...context, mailbox }));
      toast.success("Mailbox details saved");
      props.onWorkspaceChange();
    },
    onError: (error) => prompts.error(error.message),
  });

  const updateFolderRole = mutation.create<
    { role: ConfigurableFolderRole; folderId: string },
    { role: ConfigurableFolderRole; folderId: string }
  >({
    mutation: async (input) => {
      const route = apiClient.mailboxes[":mailboxId"]["folder-roles"][":role"];
      const param = { mailboxId: props.context.mailbox.id, role: input.role };
      const response = input.folderId ? await route.$put({ param, json: { folderId: input.folderId } }) : await route.$delete({ param });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to update folder role"));
      return input;
    },
    onSuccess: ({ role, folderId }) => {
      props.onContextChange((context) =>
        context.admin
          ? {
              ...context,
              admin: {
                ...context.admin,
                folders: context.admin.folders.map((folder) => ({
                  ...folder,
                  configuredRole: folder.id === folderId ? role : folder.configuredRole === role ? null : folder.configuredRole,
                })),
              },
            }
          : context,
      );
      toast.success("Folder role updated");
      props.onWorkspaceChange();
    },
    onError: (error) => prompts.error(error.message),
  });

  const setFolderVisibility = (folderId: string, showInSidebar: boolean) => {
    props.onContextChange((context) =>
      context.admin
        ? {
            ...context,
            admin: {
              ...context.admin,
              folders: context.admin.folders.map((folder) => (folder.id === folderId ? { ...folder, showInSidebar } : folder)),
            },
          }
        : context,
    );
  };

  const saveAutomaticReplyAccess = mutation.create<Mailbox, void>({
    mutation: async () => {
      const response = await apiClient.mailboxes[":mailboxId"].$patch({
        param: { mailboxId: props.context.mailbox.id },
        json: { automaticReplyManagementPermission: automaticReplyManagementPermission() },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to update automatic reply access"));
      return response.json();
    },
    onSuccess: (mailbox) => {
      props.onContextChange((context) => ({ ...context, mailbox }));
      toast.success("Automatic reply access updated");
    },
    onError: (error) => prompts.error(error.message),
  });

  const deleteMailbox = mutation.create<boolean, void>({
    mutation: async () => {
      const confirmed = await prompts.confirm(
        "This pauses the mailbox and hides it from normal use. Provider mail and Cloud data remain retained so an administrator can restore it.",
        {
          title: "Move mailbox to recently deleted?",
          confirmText: "Move to recently deleted",
          variant: "danger",
        },
      );
      if (!confirmed) return false;
      const response = await apiClient.mailboxes[":mailboxId"].$delete({ param: { mailboxId: props.context.mailbox.id } });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to move mailbox to recently deleted"));
      return true;
    },
    onSuccess: (deleted) => {
      if (deleted) props.onDeleted();
    },
    onError: (error) => prompts.error(error.message),
  });

  return (
    <SettingsModal
      title="Mailbox settings"
      activeTab={activeTab()}
      onTabChange={(tab) => void requestTabChange(tab)}
      onClose={() => void requestClose()}
      closeLabel="Close settings"
    >
      <Show when={canAdmin() && props.context.admin}>
        <SettingsModal.Tab id="mailbox" title="Mailbox" icon="ti ti-id" description="The name and context collaborators see.">
          <div class="flex flex-col gap-2">
            <TextInput label="Name" description="The label collaborators see." value={name} onInput={setName} required />
            <TextInput
              label="Description"
              description="Optional context for this mailbox."
              value={description}
              onInput={setDescription}
              multiline
              lines={3}
            />
            <div class="mt-4">
              <h3 class="text-sm font-semibold text-primary">Sending safeguards</h3>
              <p class="text-xs text-dimmed">Warn collaborators before messages leave expected boundaries or reach many people.</p>
            </div>
            <TextInput
              label="Internal email domains"
              description="Comma-separated domains. Recipients outside these domains trigger a review."
              value={internalDomains}
              onInput={setInternalDomains}
              placeholder="example.org, subsidiary.example"
            />
            <NumberInput
              label="Large recipient warning"
              description="Show a review when a message reaches at least this many unique recipients."
              value={largeRecipientThreshold}
              onInput={(value) => setLargeRecipientThreshold(value ?? 20)}
              min={5}
              max={200}
              allowNegative={false}
              suffix="recipients"
            />
            <div class="flex justify-end pt-1">
              <button
                type="button"
                class="btn-primary btn-sm"
                onClick={() => saveMailbox.mutate()}
                disabled={saveMailbox.loading() || props.reloading || !name().trim() || !ownDirty()}
              >
                <i class={`ti ${saveMailbox.loading() ? "ti-loader-2 animate-spin" : "ti-device-floppy"}`} aria-hidden="true" />
                Save mailbox
              </button>
            </div>
          </div>
        </SettingsModal.Tab>
      </Show>

      <Show when={canWrite() && props.context.compose}>
        {(compose) => (
          <SettingsModal.Tab
            id="writing"
            title="Writing"
            icon="ti ti-pencil"
            description="Personal writing defaults, reusable content, signatures, and mailbox email design."
          >
            <div class="flex flex-col gap-8">
              <section class="flex flex-col gap-2">
                <div>
                  <h3 class="text-sm font-semibold text-primary">My writing preferences</h3>
                  <p class="text-xs text-dimmed">These preferences apply only to this browser.</p>
                </div>
                <div class="flex flex-col gap-2">
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
                    description="Delay delivery so you can cancel a queued message."
                    value={undoSeconds}
                    onInput={(value) => setUndoSeconds(value ?? 0)}
                    min={0}
                    max={60}
                    allowNegative={false}
                    suffix="seconds"
                  />
                </div>
                <div class="flex justify-end pt-1">
                  <button
                    type="button"
                    class="btn-primary btn-sm"
                    disabled={savePreferences.loading() || !ownDirty()}
                    onClick={() => savePreferences.mutate()}
                  >
                    <i class={`ti ${savePreferences.loading() ? "ti-loader-2 animate-spin" : "ti-device-floppy"}`} aria-hidden="true" />
                    Save preferences
                  </button>
                </div>
              </section>
              <MailComposeSettings
                mailboxId={props.context.mailbox.id}
                permission={props.context.permission === "admin" ? "admin" : "write"}
                initialTemplates={compose().templates}
                initialDefaults={compose().defaults}
                initialStyle={compose().style}
                identities={compose().identities}
                onTemplatesChange={(templates) =>
                  props.onContextChange((context) =>
                    context.compose ? { ...context, compose: { ...context.compose, templates } } : context,
                  )
                }
              />
            </div>
          </SettingsModal.Tab>
        )}
      </Show>

      <SettingsModal.Tab
        id="organization"
        title="Organization"
        icon="ti ti-tags"
        description="Saved views and conversation tags shared through this mailbox."
      >
        <MailOrganizationSettings
          mailboxId={props.context.mailbox.id}
          permission={props.context.permission}
          initial={props.context.organization}
          onDirtyChange={(dirty) => setChildDirty("organization", dirty)}
          onWorkspaceChange={props.onWorkspaceChange}
        />
      </SettingsModal.Tab>

      <Show when={canAdmin() && props.context.admin}>
        <>
          <SettingsModal.Tab
            id="delivery"
            title="Delivery"
            icon="ti ti-send"
            description="Connect the mail provider and manage the sending identities collaborators can choose."
          >
            <div class="flex flex-col gap-8">
              <section class="flex flex-col gap-2">
                <div>
                  <h3 class="text-sm font-semibold text-primary">Connected account</h3>
                  <p class="text-xs text-dimmed">The encrypted IMAP and SMTP credential used by this mailbox.</p>
                </div>
                <MailConnectionSettings
                  mailbox={props.context.mailbox}
                  admin={admin()}
                  currentUserEmail={props.currentUserEmail}
                  reloading={props.reloading}
                  onReload={props.onReload}
                  onWorkspaceChange={props.onWorkspaceChange}
                />
              </section>
              <section class="flex flex-col gap-2">
                <div>
                  <h3 class="text-sm font-semibold text-primary">Sending identities</h3>
                  <p class="text-xs text-dimmed">Names, addresses, defaults, and signatures available while writing.</p>
                </div>
                <MailIdentitySettings
                  mailbox={props.context.mailbox}
                  admin={admin()}
                  mailboxSignatures={
                    props.context.compose?.templates.filter((template) => template.kind === "signature" && template.scope === "mailbox") ??
                    []
                  }
                  currentUserEmail={props.currentUserEmail}
                  reloading={props.reloading}
                  onDirtyChange={(dirty) => setChildDirty("identity", dirty)}
                  onReload={props.onReload}
                  onWorkspaceChange={props.onWorkspaceChange}
                />
              </section>
            </div>
          </SettingsModal.Tab>

          <SettingsModal.Tab
            id="folders"
            title="Folders"
            icon="ti ti-folders"
            description="Create provider folders and control which ones appear in Mail."
          >
            <MailFolderSettings
              mailboxId={props.context.mailbox.id}
              folders={admin().folders}
              reloading={props.reloading}
              onReload={props.onReload}
              onWorkspaceChange={props.onWorkspaceChange}
              onFolderVisibilityChange={setFolderVisibility}
              onFolderRoleChange={(role, folderId) => updateFolderRole.mutate({ role, folderId })}
              folderRolePending={updateFolderRole.loading()}
            />
          </SettingsModal.Tab>

          <SettingsModal.Tab
            id="access"
            title="Access"
            icon="ti ti-shield"
            description="Read can view and comment; write can operate mail; admin configures the mailbox."
          >
            <div class="flex flex-col gap-6">
              <section class="flex flex-col gap-2">
                <Select
                  label="Who can manage automatic replies?"
                  description="Allow writers to manage absences and acknowledgements without giving them mailbox administration."
                  icon="ti ti-message-cog"
                  value={automaticReplyManagementPermission}
                  onChange={(value) => setAutomaticReplyManagementPermission(value === "write" ? "write" : "admin")}
                  options={[
                    {
                      id: "write",
                      label: "Mailbox writers and admins",
                      description: "Team members can manage their own out-of-office replies.",
                      icon: "ti ti-pencil",
                    },
                    {
                      id: "admin",
                      label: "Mailbox admins only",
                      description: "Only mailbox administrators can change automatic replies.",
                      icon: "ti ti-shield",
                    },
                  ]}
                />
                <button
                  type="button"
                  class="btn-primary btn-sm self-end"
                  disabled={saveAutomaticReplyAccess.loading() || !ownDirty()}
                  onClick={() => saveAutomaticReplyAccess.mutate()}
                >
                  <i
                    class={`ti ${saveAutomaticReplyAccess.loading() ? "ti-loader-2 animate-spin" : "ti-device-floppy"}`}
                    aria-hidden="true"
                  />
                  Save automatic reply access
                </button>
              </section>
              <section class="flex flex-col gap-2">
                <div>
                  <h3 class="text-sm font-semibold text-primary">Mailbox access</h3>
                  <p class="text-xs text-dimmed">Permission changes are applied immediately.</p>
                </div>
                <PermissionEditor
                  initialEntries={admin().accessEntries}
                  allowServiceAccounts
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
              </section>
            </div>
          </SettingsModal.Tab>

          <SettingsModal.Tab
            id="danger"
            title="Danger zone"
            icon="ti ti-alert-triangle"
            description="Remove this mailbox from normal use without deleting retained mail."
            tone="danger"
          >
            <div class="flex items-start justify-between gap-4">
              <div>
                <p class="text-sm font-medium text-primary">Move to recently deleted</p>
                <p class="mt-1 text-xs text-dimmed">
                  The mailbox is paused and hidden. Provider mail and Cloud data remain retained for restoration.
                </p>
              </div>
              <button
                type="button"
                class="btn-danger btn-sm shrink-0"
                onClick={() => deleteMailbox.mutate()}
                disabled={deleteMailbox.loading()}
              >
                <i class={`ti ${deleteMailbox.loading() ? "ti-loader-2 animate-spin" : "ti-trash"}`} aria-hidden="true" />
                Move to recently deleted
              </button>
            </div>
          </SettingsModal.Tab>
        </>
      </Show>
    </SettingsModal>
  );
}
