import { mutation } from "@k2b/stdlib/solid";
import {
  Button,
  confirmDiscardIfDirty,
  NoticeCard,
  NumberInput,
  prompts,
  Select,
  SettingsField,
  SettingsGroup,
  SettingsModal,
  SettingsPanelFooter,
  TextInput,
  toast,
} from "@k2b/ui";
import { PermissionEditor } from "@valentinkolb/cloud/access/ui";
import { createMemo, createSignal, onCleanup, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type { ConfigurableFolderRole, Mailbox } from "../../contracts";
import type { MailboxSettingsContext } from "../../settings-context";
import { readApiError } from "./api-response";
import MailCalendarSettings from "./MailCalendarSettings";
import MailComposeSettings from "./MailComposeSettings";
import { MailConnectionSettings } from "./MailConnectionSettings";
import MailFolderSettings from "./MailFolderSettings";
import { MailIdentitySettings } from "./MailIdentitySettings";
import MailOrganizationSettings from "./MailOrganizationSettings";
import { readMailUserPreferences, writeMailUserPreferences } from "./MailSettingsStore";
import { mailboxHealthPresentation } from "./mail-health-presentation";

const normalizeInitialTab = (tab: string | undefined, canWrite: boolean, canAdmin: boolean, hasCalendar: boolean): string => {
  const aliases: Record<string, string> = {
    preferences: "writing",
    compose: "writing",
    general: "mailbox",
    connections: "delivery",
    identities: "delivery",
  };
  const requested = aliases[tab ?? ""] ?? tab;
  const allowed = new Set([
    "reading",
    "organization",
    ...(canWrite ? ["writing"] : []),
    ...(canAdmin ? ["mailbox", "delivery", "folders", "access", "danger", ...(hasCalendar ? ["calendar"] : [])] : []),
  ]);
  if (requested && allowed.has(requested)) return requested;
  return canAdmin ? "mailbox" : canWrite ? "writing" : "reading";
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
  const [savedReadingFormat, setSavedReadingFormat] = createSignal(initialPreferences.readingFormat);
  const [savedComposeFormat, setSavedComposeFormat] = createSignal(initialPreferences.composeFormat);
  const [savedUndoSeconds, setSavedUndoSeconds] = createSignal(initialPreferences.undoSeconds);
  const [readingFormat, setReadingFormat] = createSignal(initialPreferences.readingFormat);
  const [composeFormat, setComposeFormat] = createSignal(initialPreferences.composeFormat);
  const [undoSeconds, setUndoSeconds] = createSignal(initialPreferences.undoSeconds);
  const [name, setName] = createSignal(props.context.mailbox.name);
  const [description, setDescription] = createSignal(props.context.mailbox.description ?? "");
  const [internalDomains, setInternalDomains] = createSignal(props.context.mailbox.composeSafety.internalDomains.join(", "));
  const [largeRecipientThreshold, setLargeRecipientThreshold] = createSignal(props.context.mailbox.composeSafety.largeRecipientThreshold);
  const [automaticReplyManagementPermission, setAutomaticReplyManagementPermission] = createSignal<
    Mailbox["automaticReplyManagementPermission"]
  >(props.context.mailbox.automaticReplyManagementPermission);
  const [activeTab, setActiveTab] = createSignal(
    normalizeInitialTab(props.initialTab, canWrite(), canAdmin(), props.context.integrations.spacesCalendar),
  );
  const [childDirtyStates, setChildDirtyStates] = createSignal<Record<string, boolean>>({});
  const [navigationPending, setNavigationPending] = createSignal(false);
  const healthPresentation = createMemo(() => mailboxHealthPresentation(props.context.mailbox));
  const mailboxDetailsDirty = createMemo(
    () => name().trim() !== props.context.mailbox.name || description().trim() !== (props.context.mailbox.description ?? ""),
  );
  const sendingSafeguardsDirty = createMemo(
    () =>
      internalDomains() !== props.context.mailbox.composeSafety.internalDomains.join(", ") ||
      largeRecipientThreshold() !== props.context.mailbox.composeSafety.largeRecipientThreshold,
  );
  const readingChangeCount = () => (readingFormat() === savedReadingFormat() ? 0 : 1);
  const writingChangeCount = () => Number(composeFormat() !== savedComposeFormat()) + Number(undoSeconds() !== savedUndoSeconds());
  const mailboxChangeCount = () =>
    Number(name().trim() !== props.context.mailbox.name) +
    Number(description().trim() !== (props.context.mailbox.description ?? "")) +
    Number(internalDomains() !== props.context.mailbox.composeSafety.internalDomains.join(", ")) +
    Number(largeRecipientThreshold() !== props.context.mailbox.composeSafety.largeRecipientThreshold);
  const accessChangeCount = () =>
    automaticReplyManagementPermission() === props.context.mailbox.automaticReplyManagementPermission ? 0 : 1;

  const ownDirty = createMemo(() => {
    if (activeTab() === "reading") {
      return readingFormat() !== savedReadingFormat();
    }
    if (activeTab() === "writing") {
      return composeFormat() !== savedComposeFormat() || undoSeconds() !== savedUndoSeconds();
    }
    if (activeTab() === "mailbox") {
      return mailboxDetailsDirty() || sendingSafeguardsDirty();
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
    if (activeTab() === "reading") {
      setReadingFormat(savedReadingFormat());
    } else if (activeTab() === "writing") {
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

  const saveReadingPreferences = mutation.create<void, void>({
    mutation: async () => {
      writeMailUserPreferences(props.context.mailbox.id, {
        composeFormat: composeFormat(),
        readingFormat: readingFormat(),
        undoSeconds: undoSeconds(),
      });
    },
    onSuccess: () => {
      setSavedReadingFormat(readingFormat());
      toast.success("Reading preference saved");
    },
    onError: (error) => prompts.error(error.message),
  });

  const saveWritingPreferences = mutation.create<void, void>({
    mutation: async () => {
      writeMailUserPreferences(props.context.mailbox.id, {
        composeFormat: composeFormat(),
        readingFormat: readingFormat(),
        undoSeconds: undoSeconds(),
      });
    },
    onSuccess: () => {
      setSavedComposeFormat(composeFormat());
      setSavedUndoSeconds(undoSeconds());
      toast.success("Writing preferences saved");
    },
    onError: (error) => prompts.error(error.message),
  });

  const saveMailboxSettings = mutation.create<Mailbox, void>({
    mutation: async (_input, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"].$patch(
        {
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
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Failed to update mailbox settings"));
      return response.json();
    },
    onSuccess: (mailbox) => {
      setName(mailbox.name);
      setDescription(mailbox.description ?? "");
      setInternalDomains(mailbox.composeSafety.internalDomains.join(", "));
      setLargeRecipientThreshold(mailbox.composeSafety.largeRecipientThreshold);
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
    mutation: async (input, { abortSignal }) => {
      const route = apiClient.mailboxes[":mailboxId"]["folder-roles"][":role"];
      const param = { mailboxId: props.context.mailbox.id, role: input.role };
      const response = input.folderId
        ? await route.$put({ param, json: { folderId: input.folderId } }, { init: { signal: abortSignal } })
        : await route.$delete({ param }, { init: { signal: abortSignal } });
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
    mutation: async (_input, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"].$patch(
        {
          param: { mailboxId: props.context.mailbox.id },
          json: { automaticReplyManagementPermission: automaticReplyManagementPermission() },
        },
        { init: { signal: abortSignal } },
      );
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
    mutation: async (_input, { abortSignal }) => {
      const confirmed = await prompts.confirm(
        "This pauses the mailbox and hides it from normal use. Provider mail and Cloud data remain retained so an administrator can restore it.",
        {
          title: "Move mailbox to recently deleted?",
          confirmText: "Move to recently deleted",
          variant: "danger",
        },
      );
      if (!confirmed || abortSignal.aborted) return false;
      const response = await apiClient.mailboxes[":mailboxId"].$delete(
        { param: { mailboxId: props.context.mailbox.id } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Failed to move mailbox to recently deleted"));
      return true;
    },
    onSuccess: (deleted) => {
      if (deleted) props.onDeleted();
    },
    onError: (error) => prompts.error(error.message),
  });
  onCleanup(() => {
    saveReadingPreferences.abort();
    saveWritingPreferences.abort();
    saveMailboxSettings.abort();
    updateFolderRole.abort();
    saveAutomaticReplyAccess.abort();
    deleteMailbox.abort();
  });

  return (
    <SettingsModal
      title="Mailbox settings"
      activeTab={activeTab()}
      onTabChange={(tab) => void requestTabChange(tab)}
      onClose={() => void requestClose()}
      closeLabel="Close settings"
    >
      <SettingsModal.Group title="Personal">
        <SettingsModal.Tab id="reading" title="Reading" icon="ti ti-mail-opened" description="How messages appear in this browser.">
          <SettingsGroup title="Message display" description="Choose the default representation used when you open a message.">
            <SettingsField
              label="Default message format"
              description="This preference applies only to this browser."
              error={() => undefined}
              changed={() => readingChangeCount() > 0}
            >
              {(control) => (
                <Select
                  aria-label="Default message format"
                  aria-describedby={control.describedBy()}
                  value={readingFormat}
                  onValueChange={(value) => setReadingFormat(value === "html" || value === "plain" ? value : "automatic")}
                  options={[
                    {
                      id: "automatic",
                      label: "Automatic — Recommended",
                      description: "Use the safest readable format for the current theme.",
                      icon: "ti ti-adjustments-horizontal",
                    },
                    { id: "html", label: "HTML", description: "Preserve safe email layout and styling.", icon: "ti ti-code" },
                    { id: "plain", label: "Plain text", description: "Show only the text alternative.", icon: "ti ti-align-left" },
                  ]}
                />
              )}
            </SettingsField>
            <p class="text-xs text-dimmed">
              Scripts and active content are always removed. Remote images stay blocked until you choose to load them.
            </p>
          </SettingsGroup>
          <SettingsModal.Footer>
            <SettingsPanelFooter
              changeCount={readingChangeCount}
              loading={saveReadingPreferences.loading}
              onDiscard={() => setReadingFormat(savedReadingFormat())}
              onSave={() => saveReadingPreferences.mutate()}
            />
          </SettingsModal.Footer>
        </SettingsModal.Tab>
      </SettingsModal.Group>

      <Show when={canWrite() && props.context.compose}>
        {(compose) => (
          <SettingsModal.Group title="Compose">
            <SettingsModal.Tab
              id="writing"
              title="Writing"
              icon="ti ti-pencil"
              description="Personal defaults and reusable mailbox content."
            >
              <div class="flex flex-col gap-8">
                <SettingsGroup title="My writing defaults" description="These defaults apply only to this browser.">
                  <SettingsField
                    label="Compose format"
                    description="Used for new messages, replies, and forwards."
                    error={() => undefined}
                    changed={() => composeFormat() !== savedComposeFormat()}
                  >
                    {(control) => (
                      <Select
                        aria-label="Compose format"
                        aria-describedby={control.describedBy()}
                        value={composeFormat}
                        onValueChange={(value) => setComposeFormat(value === "plain" ? "plain" : "markdown")}
                        options={[
                          { id: "markdown", label: "Markdown", icon: "ti ti-markdown" },
                          { id: "plain", label: "Plain text", icon: "ti ti-align-left" },
                        ]}
                      />
                    )}
                  </SettingsField>
                  <SettingsField
                    label="Undo send window"
                    description="Delay delivery so you can cancel a queued message."
                    error={() => undefined}
                    changed={() => undoSeconds() !== savedUndoSeconds()}
                  >
                    {(control) => (
                      <NumberInput
                        aria-label="Undo send window"
                        aria-describedby={control.describedBy()}
                        value={undoSeconds}
                        onValueChange={(value) => setUndoSeconds(value ?? 0)}
                        min={0}
                        max={60}
                        allowNegative={false}
                        suffix="seconds"
                      />
                    )}
                  </SettingsField>
                </SettingsGroup>
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
              <SettingsModal.Footer>
                <SettingsPanelFooter
                  changeCount={writingChangeCount}
                  loading={saveWritingPreferences.loading}
                  onDiscard={() => {
                    setComposeFormat(savedComposeFormat());
                    setUndoSeconds(savedUndoSeconds());
                  }}
                  onSave={() => saveWritingPreferences.mutate()}
                />
              </SettingsModal.Footer>
            </SettingsModal.Tab>
          </SettingsModal.Group>
        )}
      </Show>

      <SettingsModal.Group title="Mailbox">
        <Show when={canAdmin() && props.context.admin}>
          <SettingsModal.Tab id="mailbox" title="General" icon="ti ti-id" description="Shared identity and sending safeguards.">
            <SettingsGroup title="Identity" description="Set the name and context collaborators see.">
              <SettingsField
                label="Name"
                description="Shown in navigation and mailbox selectors."
                error={() => (!name().trim() ? "Name is required" : undefined)}
                changed={() => name().trim() !== props.context.mailbox.name}
              >
                {(control) => (
                  <TextInput
                    aria-label="Name"
                    aria-describedby={control.describedBy()}
                    value={name}
                    onValueChange={setName}
                    required
                    disabled={saveMailboxSettings.loading() || props.reloading}
                  />
                )}
              </SettingsField>
              <SettingsField
                label="Description"
                description="Optional context for collaborators."
                error={() => undefined}
                changed={() => description().trim() !== (props.context.mailbox.description ?? "")}
              >
                {(control) => (
                  <TextInput
                    aria-label="Description"
                    aria-describedby={control.describedBy()}
                    value={description}
                    onValueChange={setDescription}
                    multiline
                    lines={3}
                    disabled={saveMailboxSettings.loading() || props.reloading}
                  />
                )}
              </SettingsField>
            </SettingsGroup>
            <SettingsGroup
              title="Sending safeguards"
              description="Warn collaborators before messages leave expected boundaries or reach many people."
            >
              <SettingsField
                label="Internal email domains"
                description="Recipients outside these comma-separated domains trigger a review."
                error={() => undefined}
                changed={() => internalDomains() !== props.context.mailbox.composeSafety.internalDomains.join(", ")}
              >
                {(control) => (
                  <TextInput
                    aria-label="Internal email domains"
                    aria-describedby={control.describedBy()}
                    value={internalDomains}
                    onValueChange={setInternalDomains}
                    placeholder="example.org, subsidiary.example"
                    disabled={saveMailboxSettings.loading() || props.reloading}
                  />
                )}
              </SettingsField>
              <SettingsField
                label="Large recipient warning"
                description="Show a review at this number of unique recipients."
                error={() => undefined}
                changed={() => largeRecipientThreshold() !== props.context.mailbox.composeSafety.largeRecipientThreshold}
              >
                {(control) => (
                  <NumberInput
                    aria-label="Large recipient warning"
                    aria-describedby={control.describedBy()}
                    value={largeRecipientThreshold}
                    onValueChange={(value) => setLargeRecipientThreshold(value ?? 20)}
                    min={5}
                    max={200}
                    allowNegative={false}
                    suffix="recipients"
                    disabled={saveMailboxSettings.loading() || props.reloading}
                  />
                )}
              </SettingsField>
            </SettingsGroup>
            <SettingsModal.Footer>
              <SettingsPanelFooter
                changeCount={mailboxChangeCount}
                loading={() => saveMailboxSettings.loading() || props.reloading}
                saveDisabled={() => !name().trim()}
                onDiscard={() => {
                  setName(props.context.mailbox.name);
                  setDescription(props.context.mailbox.description ?? "");
                  setInternalDomains(props.context.mailbox.composeSafety.internalDomains.join(", "));
                  setLargeRecipientThreshold(props.context.mailbox.composeSafety.largeRecipientThreshold);
                }}
                onSave={() => saveMailboxSettings.mutate()}
              />
            </SettingsModal.Footer>
          </SettingsModal.Tab>
        </Show>

        <SettingsModal.Tab id="organization" title="Organization" icon="ti ti-tags" description="Saved views and conversation tags.">
          <MailOrganizationSettings
            mailboxId={props.context.mailbox.id}
            permission={props.context.permission}
            initial={props.context.organization}
            onDirtyChange={(dirty) => setChildDirty("organization", dirty)}
            onWorkspaceChange={props.onWorkspaceChange}
          />
        </SettingsModal.Tab>
      </SettingsModal.Group>

      <Show when={canAdmin() && props.context.admin}>
        <SettingsModal.Group title="Delivery">
          <SettingsModal.Tab
            id="delivery"
            title="Accounts & identities"
            icon="ti ti-send"
            description="Provider connection and selectable sender identities."
          >
            <div class="flex flex-col gap-8">
              <Show when={healthPresentation()}>
                {(health) => (
                  <NoticeCard tone={health().tone} icon={false} bodyClass="flex items-start gap-2" role="status">
                    <i
                      class={`ti ${health().tone === "warning" ? "ti-alert-triangle" : "ti-info-circle"} mt-0.5 shrink-0`}
                      aria-hidden="true"
                    />
                    <span>
                      <strong class="font-semibold text-primary">{health().title}.</strong> {health().message}
                    </span>
                  </NoticeCard>
                )}
              </Show>
              <SettingsGroup title="Connected account" description="The encrypted IMAP and SMTP credential used by this mailbox.">
                <MailConnectionSettings
                  mailbox={props.context.mailbox}
                  admin={admin()}
                  currentUserEmail={props.currentUserEmail}
                  reloading={props.reloading}
                  onReload={props.onReload}
                  onWorkspaceChange={props.onWorkspaceChange}
                />
              </SettingsGroup>
              <MailIdentitySettings
                mailbox={props.context.mailbox}
                admin={admin()}
                mailboxSignatures={
                  props.context.compose?.templates.filter((template) => template.kind === "signature" && template.scope === "mailbox") ?? []
                }
                currentUserEmail={props.currentUserEmail}
                reloading={props.reloading}
                onDirtyChange={(dirty) => setChildDirty("identity", dirty)}
                onReload={props.onReload}
                onWorkspaceChange={props.onWorkspaceChange}
              />
            </div>
          </SettingsModal.Tab>
          <Show when={props.context.integrations.spacesCalendar}>
            <SettingsModal.Tab
              id="calendar"
              title="Calendar invitations"
              icon="ti ti-calendar-event"
              description="Default destination for imported invitations."
            >
              <MailCalendarSettings mailboxId={props.context.mailbox.id} onDirtyChange={(dirty) => setChildDirty("calendar", dirty)} />
            </SettingsModal.Tab>
          </Show>

          <SettingsModal.Tab
            id="folders"
            title="Folders"
            icon="ti ti-folders"
            description="Provider folders, mappings, and mailbox visibility."
          >
            <SettingsGroup title="Mailbox folders" description="Changes to visibility and provider subscriptions apply immediately.">
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
            </SettingsGroup>
          </SettingsModal.Tab>
        </SettingsModal.Group>

        <SettingsModal.Group title="Sharing">
          <SettingsModal.Tab
            id="access"
            title="Access"
            icon="ti ti-shield"
            description="Mailbox permissions and delegated reply management."
          >
            <SettingsGroup title="Automatic replies" description="Choose who may manage absences and acknowledgements.">
              <SettingsField
                label="Management access"
                description="This does not grant broader mailbox administration."
                error={() => undefined}
                changed={() => accessChangeCount() > 0}
              >
                {(control) => (
                  <Select
                    aria-label="Automatic reply management access"
                    aria-describedby={control.describedBy()}
                    icon="ti ti-message-cog"
                    value={automaticReplyManagementPermission}
                    onValueChange={(value) => setAutomaticReplyManagementPermission(value === "write" ? "write" : "admin")}
                    options={[
                      {
                        id: "write",
                        label: "Writers and administrators",
                        description: "Writers can manage automatic replies.",
                        icon: "ti ti-pencil",
                      },
                      {
                        id: "admin",
                        label: "Administrators only",
                        description: "Only mailbox administrators can change automatic replies.",
                        icon: "ti ti-shield",
                      },
                    ]}
                  />
                )}
              </SettingsField>
            </SettingsGroup>
            <SettingsGroup title="People and integrations" description="Permission changes apply immediately.">
              <PermissionEditor
                initialEntries={admin().accessEntries}
                allowAuthenticated={false}
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
            </SettingsGroup>
            <SettingsModal.Footer>
              <SettingsPanelFooter
                changeCount={accessChangeCount}
                loading={saveAutomaticReplyAccess.loading}
                onDiscard={() => setAutomaticReplyManagementPermission(props.context.mailbox.automaticReplyManagementPermission)}
                onSave={() => saveAutomaticReplyAccess.mutate()}
              />
            </SettingsModal.Footer>
          </SettingsModal.Tab>
        </SettingsModal.Group>

        <SettingsModal.Group title="Lifecycle">
          <SettingsModal.Tab
            id="danger"
            title="Danger zone"
            icon="ti ti-alert-triangle"
            description="Remove this mailbox from normal use."
            tone="danger"
          >
            <SettingsGroup
              title="Move to recently deleted"
              description="Pause and hide the mailbox while retaining provider mail and Cloud data for restoration."
            >
              <SettingsGroup.Action>
                <Button variant="danger" size="sm" type="button" onClick={() => deleteMailbox.mutate()} disabled={deleteMailbox.loading()}>
                  <i class={`ti ${deleteMailbox.loading() ? "ti-loader-2 animate-spin" : "ti-trash"}`} aria-hidden="true" />
                  Move to recently deleted
                </Button>
              </SettingsGroup.Action>
            </SettingsGroup>
          </SettingsModal.Tab>
        </SettingsModal.Group>
      </Show>
    </SettingsModal>
  );
}
