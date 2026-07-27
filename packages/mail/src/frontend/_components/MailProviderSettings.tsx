import {
  CheckboxCard,
  confirmDiscardIfDirty,
  dialogCore,
  Dropdown,
  FileDropzone,
  NumberInput,
  PanelDialog,
  Placeholder,
  panelDialogFixedOptions,
  prompts,
  Select,
  Switch,
  TextInput,
  toast,
} from "@valentinkolb/cloud/ui";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type {
  ComposeTemplate,
  Mailbox,
  MailComposeFormat,
  MailOAuthProviderId,
  MailPriority,
  ProviderConnectionDetails,
  SenderIdentity,
  SenderIdentityTransport,
} from "../../contracts";
import type { DiscoveredMailConfiguration } from "../../service/onboarding-discovery";
import type { MailboxAdminSettingsContext } from "../../settings-context";
import { readApiError } from "./api-response";
import MailRecipientInput from "./MailRecipientInput";
import { deriveDefaultSenderSetupState } from "./mail-provider-setup";
import { formatMailRecipients, parseMailRecipients } from "./mail-recipient";

type ProviderSettingsProps = {
  mailbox: Mailbox;
  admin: MailboxAdminSettingsContext;
  currentUserEmail: string | null;
  reloading: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onReload: () => Promise<void>;
  onWorkspaceChange: () => void;
};

const EditorHeading = (props: { title: string; description: string; onBack: () => void | Promise<void> }) => (
  <div class="flex items-start gap-2">
    <button type="button" class="icon-btn shrink-0" aria-label="Back" onClick={() => void props.onBack()}>
      <i class="ti ti-arrow-left" aria-hidden="true" />
    </button>
    <div class="min-w-0">
      <h3 class="text-sm font-semibold text-primary">{props.title}</h3>
      <p class="mt-1 text-xs text-dimmed">{props.description}</p>
    </div>
  </div>
);
const connectionEditorDialogOptions = { ...panelDialogFixedOptions, cancelBehavior: "ignore" as const };

export function MailConnectionSettings(props: ProviderSettingsProps) {
  const [editing, setEditing] = createSignal(false);
  const [replacingConnectionId, setReplacingConnectionId] = createSignal<string | null>(null);
  const [name, setName] = createSignal(props.mailbox.name);
  const [email, setEmail] = createSignal(props.currentUserEmail ?? "");
  const [username, setUsername] = createSignal(props.currentUserEmail ?? "");
  const [imapHost, setImapHost] = createSignal("");
  const [imapPort, setImapPort] = createSignal(993);
  const [imapTls, setImapTls] = createSignal<"implicit" | "starttls">("implicit");
  const [smtpHost, setSmtpHost] = createSignal("");
  const [smtpPort, setSmtpPort] = createSignal(587);
  const [smtpTls, setSmtpTls] = createSignal<"implicit" | "starttls">("starttls");
  const [auth, setAuth] = createSignal<"password" | "oauth2">("password");
  const [secret, setSecret] = createSignal("");
  const [createSender, setCreateSender] = createSignal(true);
  const [savesSentAutomatically, setSavesSentAutomatically] = createSignal(false);
  const [discoverySource, setDiscoverySource] = createSignal<string | null>(null);
  const [oauthProviderId, setOAuthProviderId] = createSignal<MailOAuthProviderId | null>(null);
  const [editorBaseline, setEditorBaseline] = createSignal("");
  let closeConnectionDialog: (() => void) | null = null;
  const currentConnection = createMemo(() => props.admin.connections.find((connection) => connection.status !== "revoked"));
  const currentBinding = createMemo(() => {
    const connection = currentConnection();
    return connection
      ? props.admin.bindings.find((binding) => binding.connectionId === connection.id && binding.state !== "revoked")
      : undefined;
  });
  const senderSetupState = createMemo(() => deriveDefaultSenderSetupState(currentConnection(), currentBinding(), props.admin.identities));
  const senderSetupPrompt = createMemo(() => {
    const state = senderSetupState();
    return state.kind === "optional" || state.kind === "needs-verification" ? state : null;
  });
  const editorValue = () =>
    JSON.stringify({
      replacingConnectionId: replacingConnectionId(),
      name: name(),
      email: email(),
      username: username(),
      imapHost: imapHost(),
      imapPort: imapPort(),
      imapTls: imapTls(),
      smtpHost: smtpHost(),
      smtpPort: smtpPort(),
      smtpTls: smtpTls(),
      auth: auth(),
      secret: secret(),
      createSender: createSender(),
      savesSentAutomatically: savesSentAutomatically(),
    });
  const editorDirty = () => editing() && editorValue() !== editorBaseline();
  const captureEditorBaseline = () => setEditorBaseline(editorValue());
  const closeEditor = async () => {
    if (!(await confirmDiscardIfDirty(editorDirty))) return;
    closeConnectionDialog?.();
    closeConnectionDialog = null;
    setEditing(false);
  };

  const resetEditor = () => {
    setReplacingConnectionId(null);
    setName(props.mailbox.name);
    setEmail(props.currentUserEmail ?? "");
    setUsername(props.currentUserEmail ?? "");
    setImapHost("");
    setImapPort(993);
    setImapTls("implicit");
    setSmtpHost("");
    setSmtpPort(587);
    setSmtpTls("starttls");
    setAuth("password");
    setSecret("");
    setCreateSender(true);
    setSavesSentAutomatically(false);
    setDiscoverySource(null);
    setOAuthProviderId(null);
    captureEditorBaseline();
  };

  const prepareEdit = () => {
    const connection = currentConnection();
    if (!connection) return;
    setReplacingConnectionId(connection.id);
    setName(connection.name);
    setEmail(connection.email);
    setUsername(connection.username);
    setImapHost(connection.imap.host);
    setImapPort(connection.imap.port);
    setImapTls(connection.imap.tlsMode);
    setSmtpHost(connection.smtp.host);
    setSmtpPort(connection.smtp.port);
    setSmtpTls(connection.smtp.tlsMode);
    setAuth(connection.secret.kind);
    setSecret("");
    setCreateSender(false);
    setSavesSentAutomatically(false);
    setDiscoverySource(null);
    setOAuthProviderId(connection.oauth?.providerId ?? null);
    captureEditorBaseline();
  };

  const discover = mutation.create<DiscoveredMailConfiguration[], void>({
    mutation: async (_input, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"]["provider-discovery"].$get(
        {
          param: { mailboxId: props.mailbox.id },
          query: { email: email().trim() },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not discover provider settings"));
      return response.json();
    },
    onSuccess: (candidates) => {
      const candidate = candidates[0];
      if (!candidate) {
        setDiscoverySource(null);
        return void toast("No provider configuration was published. Enter the server settings manually.", {
          title: "No settings found",
        });
      }
      setUsername(candidate.username);
      setImapHost(candidate.imap.host);
      setImapPort(candidate.imap.port);
      setImapTls(candidate.imap.tlsMode);
      setSmtpHost(candidate.smtp.host);
      setSmtpPort(candidate.smtp.port);
      setSmtpTls(candidate.smtp.tlsMode);
      setAuth(candidate.authentication.includes("password") ? "password" : "oauth2");
      setOAuthProviderId(candidate.oauthProviderId);
      setDiscoverySource(candidate.source.replaceAll("_", " "));
      toast.success("Provider settings found");
    },
    onError: (error) => prompts.error(error.message),
  });

  const canSubmit = createMemo(
    () =>
      Boolean(name().trim() && email().trim() && username().trim() && imapHost().trim() && smtpHost().trim() && secret()) &&
      imapPort() >= 1 &&
      imapPort() <= 65_535 &&
      smtpPort() >= 1 &&
      smtpPort() <= 65_535,
  );

  const canStartOAuth = createMemo(
    () =>
      Boolean(name().trim() && email().trim() && username().trim() && imapHost().trim() && smtpHost().trim()) &&
      imapPort() >= 1 &&
      imapPort() <= 65_535 &&
      smtpPort() >= 1 &&
      smtpPort() <= 65_535,
  );

  const startOAuth = mutation.create<
    void,
    { providerId: MailOAuthProviderId; connectionId?: string; connection?: ProviderConnectionDetails }
  >({
    mutation: async ({ providerId, connectionId, connection }, { abortSignal }) => {
      const json = connectionId
        ? ({ operation: "reconnect", providerId, connectionId, ...(connection ? { connection } : {}) } as const)
        : ({
            operation: "create",
            providerId,
            createSender: createSender(),
            savesSentAutomatically: savesSentAutomatically(),
            connection: {
              name: name().trim(),
              email: email().trim(),
              username: username().trim(),
              imap: { host: imapHost().trim(), port: imapPort(), tlsMode: imapTls() },
              smtp: { host: smtpHost().trim(), port: smtpPort(), tlsMode: smtpTls() },
            },
          } as const);
      const response = await apiClient.mailboxes[":mailboxId"].oauth.start.$post(
        { param: { mailboxId: props.mailbox.id }, json },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not start browser OAuth"));
      const result = await response.json();
      if (abortSignal.aborted) return;
      window.location.assign(result.authorizationUrl);
    },
    onError: (error) => prompts.error(error.message),
  });

  const requestDefaultSenderSetup = async (bindingId: string, abortSignal?: AbortSignal) => {
    const response = await apiClient.mailboxes[":mailboxId"]["sender-identities"].default.setup.$post(
      {
        param: { mailboxId: props.mailbox.id },
        json: { bindingId, savesSentAutomatically: savesSentAutomatically() },
      },
      { init: { signal: abortSignal } },
    );
    if (!response.ok) throw new Error(await readApiError(response, "Default identity setup failed"));
    return response.json();
  };

  const attachConnection = async (
    connectionId: string,
    setupSenderAfterAttach: boolean,
    abortSignal?: AbortSignal,
  ): Promise<{ senderCreated: boolean; setupError: string | null }> => {
    const bindingResponse = await apiClient.mailboxes[":mailboxId"].bindings.$post(
      {
        param: { mailboxId: props.mailbox.id },
        json: { connectionId },
      },
      { init: { signal: abortSignal } },
    );
    if (!bindingResponse.ok) {
      const reason = await readApiError(bindingResponse, "Folder discovery failed");
      return {
        senderCreated: false,
        setupError: `Account connected, but incoming mail setup still needs attention. ${reason}`,
      };
    }
    const binding = await bindingResponse.json();
    if (!setupSenderAfterAttach) return { senderCreated: false, setupError: null };
    try {
      await requestDefaultSenderSetup(binding.id, abortSignal);
      return { senderCreated: true, setupError: null };
    } catch (error) {
      return {
        senderCreated: false,
        setupError: `Receiving is active, but sending still needs setup. ${error instanceof Error ? error.message : "Default identity setup failed"}`,
      };
    }
  };

  const connect = mutation.create<{ senderCreated: boolean; setupError: string | null; replaced: boolean }, void>({
    mutation: async (_input, { abortSignal }) => {
      const input = {
        name: name().trim(),
        email: email().trim(),
        username: username().trim(),
        imap: { host: imapHost().trim(), port: imapPort(), tlsMode: imapTls() },
        smtp: { host: smtpHost().trim(), port: smtpPort(), tlsMode: smtpTls() },
        secret:
          auth() === "oauth2" ? { kind: "oauth2" as const, accessToken: secret() } : { kind: "password" as const, password: secret() },
      };
      const replacementId = replacingConnectionId();
      const connectionResponse = replacementId
        ? await apiClient.mailboxes[":mailboxId"].connections[":connectionId"].$put(
            {
              param: { mailboxId: props.mailbox.id, connectionId: replacementId },
              json: input,
            },
            { init: { signal: abortSignal } },
          )
        : await apiClient.mailboxes[":mailboxId"].connections.$post(
            {
              param: { mailboxId: props.mailbox.id },
              json: input,
            },
            { init: { signal: abortSignal } },
          );
      if (!connectionResponse.ok) throw new Error(await readApiError(connectionResponse, "Provider verification failed"));
      const created = await connectionResponse.json();
      if (replacementId) return { senderCreated: false, setupError: null, replaced: true };
      return { ...(await attachConnection(created.connection.id, createSender(), abortSignal)), replaced: false };
    },
    onSuccess: (result) => {
      if (!result.setupError) {
        toast.success(
          result.replaced
            ? "Connected account updated"
            : result.senderCreated
              ? "Provider and default identity connected"
              : "Provider connected",
        );
      }
      closeConnectionDialog?.();
      closeConnectionDialog = null;
      setEditing(false);
      setEditorBaseline("");
      setReplacingConnectionId(null);
      props.onWorkspaceChange();
      void props.onReload();
      if (result.setupError) void prompts.error(result.setupError);
    },
    onError: (error) => {
      void props.onReload();
      prompts.error(error.message);
    },
  });

  const revoke = mutation.create<boolean, string>({
    mutation: async (connectionId, { abortSignal }) => {
      const confirmed = await prompts.confirm(
        "This permanently removes the encrypted credential, disconnects the remote mailbox, and stops provider operations until another connection is configured.",
        { title: "Remove provider connection?", confirmText: "Remove connection", variant: "danger" },
      );
      if (!confirmed || abortSignal.aborted) return false;
      const response = await apiClient.mailboxes[":mailboxId"].connections[":connectionId"].$delete(
        { param: { mailboxId: props.mailbox.id, connectionId } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Failed to remove provider connection"));
      return true;
    },
    onSuccess: async (revoked) => {
      if (!revoked) return;
      toast.success("Provider connection removed");
      props.onWorkspaceChange();
      await props.onReload();
    },
    onError: (error) => prompts.error(error.message),
  });

  const finishSetup = mutation.create<{ senderCreated: boolean; setupError: string | null }, string>({
    mutation: (connectionId, { abortSignal }) => attachConnection(connectionId, false, abortSignal),
    onSuccess: (result) => {
      if (!result.setupError) toast.success(result.senderCreated ? "Provider and default identity connected" : "Provider connected");
      props.onWorkspaceChange();
      void props.onReload();
      if (result.setupError) void prompts.error(result.setupError);
    },
    onError: (error) => prompts.error(error.message),
  });

  const setupSender = mutation.create<SenderIdentity, string>({
    mutation: (bindingId, { abortSignal }) => requestDefaultSenderSetup(bindingId, abortSignal),
    onSuccess: (identity) => {
      toast.success(`${identity.fromAddress} is ready to send`);
      props.onWorkspaceChange();
      void props.onReload();
    },
    onError: (error) => prompts.error(`Receiving remains active. ${error.message}`),
  });
  onCleanup(() => {
    discover.abort();
    startOAuth.abort();
    connect.abort();
    revoke.abort();
    finishSetup.abort();
    setupSender.abort();
  });

  const openConnectionEditor = async () => {
    setEditing(true);
    try {
      await dialogCore.open<void>((close) => {
        closeConnectionDialog = () => close();
        return (
          <PanelDialog>
            <PanelDialog.Header
              title={replacingConnectionId() ? "Edit connected account" : "Connect account"}
              subtitle="Verify incoming and outgoing mail before saving"
              icon="ti ti-server-cog"
              close={() => void closeEditor()}
            />
            <PanelDialog.Body>
              <PanelDialog.Section title="Account" subtitle="The mailbox address and provider login." icon="ti ti-at">
                <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <TextInput
                    label="Label"
                    description="The private name shown to mailbox administrators."
                    value={name}
                    onInput={setName}
                    required
                  />
                  <div class="flex items-end gap-2">
                    <div class="min-w-0 flex-1">
                      <TextInput
                        label="Email address"
                        description="Used to find the provider's server settings."
                        type="email"
                        value={email}
                        onInput={setEmail}
                        required
                      />
                    </div>
                    <button
                      type="button"
                      class="btn-secondary btn-sm shrink-0"
                      disabled={!email().trim() || discover.loading()}
                      onClick={() => discover.mutate()}
                    >
                      <i class={`ti ${discover.loading() ? "ti-loader-2 animate-spin" : "ti-wand"}`} aria-hidden="true" />
                      Find settings
                    </button>
                  </div>
                </div>
                <Show when={discoverySource()}>
                  {(source) => (
                    <div class="info-block-success text-xs" role="status">
                      Server settings were filled from {source()}. Review them, then enter the account secret.
                    </div>
                  )}
                </Show>
                <TextInput
                  label="Username"
                  description="The login name used for incoming and outgoing mail."
                  value={username}
                  onInput={setUsername}
                  required
                />
              </PanelDialog.Section>

              <PanelDialog.Section
                title="Server settings"
                subtitle="Automatic discovery fills these values when the provider publishes them."
                icon="ti ti-server"
              >
                <div>
                  <p class="mb-1 text-xs font-semibold text-primary">Incoming mail</p>
                  <div class="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_11rem]">
                    <TextInput label="IMAP host" placeholder="imap.example.com" value={imapHost} onInput={setImapHost} required />
                    <NumberInput label="Port" value={imapPort} onInput={(value) => setImapPort(value ?? 993)} min={1} max={65_535} />
                    <Select
                      label="TLS"
                      value={imapTls}
                      onChange={(value) => setImapTls(value === "starttls" ? "starttls" : "implicit")}
                      options={[
                        { id: "implicit", label: "Implicit TLS" },
                        { id: "starttls", label: "STARTTLS" },
                      ]}
                    />
                  </div>
                </div>
                <div>
                  <p class="mb-1 text-xs font-semibold text-primary">Outgoing mail</p>
                  <div class="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_11rem]">
                    <TextInput label="SMTP host" placeholder="smtp.example.com" value={smtpHost} onInput={setSmtpHost} required />
                    <NumberInput label="Port" value={smtpPort} onInput={(value) => setSmtpPort(value ?? 587)} min={1} max={65_535} />
                    <Select
                      label="TLS"
                      value={smtpTls}
                      onChange={(value) => setSmtpTls(value === "implicit" ? "implicit" : "starttls")}
                      options={[
                        { id: "starttls", label: "STARTTLS" },
                        { id: "implicit", label: "Implicit TLS" },
                      ]}
                    />
                  </div>
                </div>
              </PanelDialog.Section>

              <PanelDialog.Section
                title="Authentication"
                subtitle={
                  replacingConnectionId()
                    ? "Enter the complete credential again. It is verified before the saved account is updated."
                    : "The credential is encrypted after verification and never shown again."
                }
                icon="ti ti-key"
              >
                <Show when={oauthProviderId()}>
                  {(providerId) => (
                    <button
                      type="button"
                      class="btn-primary btn-sm self-start"
                      disabled={!canStartOAuth() || startOAuth.loading()}
                      onClick={() =>
                        startOAuth.mutate({
                          providerId: providerId(),
                          connectionId: replacingConnectionId() ?? undefined,
                          connection: replacingConnectionId()
                            ? {
                                name: name().trim(),
                                email: email().trim(),
                                username: username().trim(),
                                imap: { host: imapHost().trim(), port: imapPort(), tlsMode: imapTls() },
                                smtp: { host: smtpHost().trim(), port: smtpPort(), tlsMode: smtpTls() },
                              }
                            : undefined,
                        })
                      }
                    >
                      <i class={startOAuth.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-login-2"} aria-hidden="true" />
                      Continue with {providerId() === "google" ? "Google" : "Microsoft"}
                    </button>
                  )}
                </Show>
                <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Select
                    label="Authentication"
                    description="Choose how Mail signs in to the provider."
                    value={auth}
                    onChange={(value) => setAuth(value === "oauth2" ? "oauth2" : "password")}
                    options={[
                      { id: "password", label: "Password" },
                      { id: "oauth2", label: "OAuth2 access token" },
                    ]}
                  />
                  <TextInput
                    label={auth() === "oauth2" ? "Access token" : "Password"}
                    description="Encrypted after verification and never shown again."
                    value={secret}
                    onInput={setSecret}
                    password
                    required
                    autocomplete="off"
                  />
                </div>
                <Show when={!replacingConnectionId()}>
                  <div class="flex flex-col gap-2">
                    <CheckboxCard
                      label="Use this address for sending"
                      description="Creates and verifies the default sending identity after incoming mail is connected."
                      icon="ti ti-at"
                      value={createSender}
                      onChange={setCreateSender}
                    />
                    <Show when={createSender()}>
                      <div class="px-1">
                        <Switch
                          label="Provider saves sent mail automatically"
                          value={savesSentAutomatically}
                          onChange={setSavesSentAutomatically}
                        />
                      </div>
                    </Show>
                  </div>
                </Show>
              </PanelDialog.Section>
            </PanelDialog.Body>
            <PanelDialog.Footer>
              <span />
              <div class="flex items-center gap-2">
                <button type="button" class="btn-simple btn-sm" disabled={connect.loading()} onClick={() => void closeEditor()}>
                  Cancel
                </button>
                <button
                  type="button"
                  class="btn-primary btn-sm"
                  disabled={!canSubmit() || connect.loading()}
                  onClick={() => connect.mutate()}
                >
                  <i class={connect.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-plug-connected"} aria-hidden="true" />
                  {replacingConnectionId() ? "Verify and save" : "Verify and connect"}
                </button>
              </div>
            </PanelDialog.Footer>
          </PanelDialog>
        );
      }, connectionEditorDialogOptions);
    } finally {
      closeConnectionDialog = null;
      setEditing(false);
    }
  };

  return (
    <div class="flex flex-col gap-2">
      <Show
        when={currentConnection()}
        fallback={
          <Placeholder
            title="No connected account"
            description="Connect an IMAP and SMTP account to synchronize mail."
            icon="ti ti-plug-off"
            action={
              <button
                type="button"
                class="btn-primary btn-sm"
                disabled={props.reloading}
                onClick={() => {
                  resetEditor();
                  void openConnectionEditor();
                }}
              >
                <i class="ti ti-plus" aria-hidden="true" />
                Connect account
              </button>
            }
          />
        }
      >
        {(connection) => (
          <div class="group flex min-h-14 items-center gap-3 rounded-[var(--ui-radius-control)] px-2 py-2 hover:bg-[var(--ui-hover)]">
            <span class="thumbnail flex h-9 w-9 shrink-0 items-center justify-center">
              <i class="ti ti-server text-secondary" aria-hidden="true" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-primary">{connection().name}</span>
              <span class="block truncate text-xs text-dimmed">
                {connection().email} · {connection().imap.host}
                <Show when={connection().oauth}> {` · ${connection().oauth?.state.replaceAll("_", " ")}`}</Show>
                <Show when={currentBinding()}> {` · mailbox ${currentBinding()?.state.replaceAll("_", " ")}`}</Show>
              </span>
            </span>
            <span class="badge capitalize">{connection().status.replaceAll("_", " ")}</span>
            <Show when={!currentBinding()}>
              <button
                type="button"
                class="btn-secondary btn-sm"
                disabled={finishSetup.loading() || props.reloading}
                onClick={() => finishSetup.mutate(connection().id)}
              >
                <i class={finishSetup.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-plug-connected"} aria-hidden="true" />
                Finish setup
              </button>
            </Show>
            <Dropdown
              trigger={
                <button
                  type="button"
                  class="icon-btn opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                  aria-label="Connected account actions"
                  disabled={props.reloading || revoke.loading() || startOAuth.loading()}
                >
                  <i class="ti ti-dots" aria-hidden="true" />
                </button>
              }
              elements={[
                {
                  label: "Edit account",
                  icon: "ti ti-pencil",
                  action: () => {
                    prepareEdit();
                    void openConnectionEditor();
                  },
                },
                ...(connection().oauth
                  ? [
                      {
                        label: "Reconnect account",
                        icon: "ti ti-refresh",
                        action: () =>
                          startOAuth.mutate({
                            providerId: connection().oauth!.providerId,
                            connectionId: connection().id,
                          }),
                      },
                    ]
                  : []),
                {
                  sectionLabel: "Danger zone",
                  items: [
                    {
                      label: "Remove account",
                      icon: "ti ti-trash",
                      variant: "danger" as const,
                      action: () => revoke.mutate(connection().id),
                    },
                  ],
                },
              ]}
              position="bottom-left"
            />
          </div>
        )}
      </Show>
      <Show when={senderSetupPrompt()}>
        {(state) => (
          <Placeholder
            align="left"
            state={state().kind === "needs-verification" ? "error" : "empty"}
            icon={state().kind === "needs-verification" ? "ti ti-alert-circle" : "ti ti-send-off"}
            title={state().kind === "needs-verification" ? "Sending needs verification" : "Sending is not configured"}
            description={
              state().kind === "needs-verification"
                ? "Receiving is active. Retry the default identity setup without reconnecting the account."
                : "This account currently receives mail only. You can add the default sending identity at any time."
            }
            action={
              <div class="flex flex-wrap items-center gap-2">
                <Switch
                  label="Provider saves sent mail automatically"
                  value={savesSentAutomatically}
                  onChange={setSavesSentAutomatically}
                  disabled={setupSender.loading()}
                />
                <button
                  type="button"
                  class="btn-secondary btn-sm"
                  disabled={!currentBinding() || setupSender.loading() || props.reloading}
                  onClick={() => {
                    const binding = currentBinding();
                    if (binding) setupSender.mutate(binding.id);
                  }}
                >
                  <i class={setupSender.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-send"} aria-hidden="true" />
                  Set up sending
                </button>
              </div>
            }
          />
        )}
      </Show>
    </div>
  );
}

type IdentityEditor = { kind: "create" } | { kind: "edit"; identity: SenderIdentity } | { kind: "verify"; identity: SenderIdentity };

export function MailIdentitySettings(props: ProviderSettingsProps & { mailboxSignatures: ComposeTemplate[] }) {
  const [editor, setEditor] = createSignal<IdentityEditor | null>(null);
  const [identities, setIdentities] = createSignal(props.admin.identities);
  const [label, setLabel] = createSignal("");
  const [displayName, setDisplayName] = createSignal("");
  const [address, setAddress] = createSignal("");
  const [replyTo, setReplyTo] = createSignal("");
  const [defaultCc, setDefaultCc] = createSignal<string[]>([]);
  const [defaultBcc, setDefaultBcc] = createSignal<string[]>([]);
  const [defaultFormat, setDefaultFormat] = createSignal<MailComposeFormat>("markdown");
  const [defaultPriority, setDefaultPriority] = createSignal<MailPriority>("normal");
  const [defaultDeliveryReceipt, setDefaultDeliveryReceipt] = createSignal(false);
  const [defaultReadReceipt, setDefaultReadReceipt] = createSignal(false);
  const [vcard, setVcard] = createSignal<string | null>(null);
  const [vcardError, setVcardError] = createSignal<string | null>(null);
  const [envelopeSender, setEnvelopeSender] = createSignal("");
  const [defaultSignatureTemplateId, setDefaultSignatureTemplateId] = createSignal("");
  const [sentFolderId, setSentFolderId] = createSignal("");
  const [draftsFolderId, setDraftsFolderId] = createSignal("");
  const [isDefault, setIsDefault] = createSignal(false);
  const [allowAutomation, setAllowAutomation] = createSignal(true);
  const [bindingId, setBindingId] = createSignal("");
  const [recipient, setRecipient] = createSignal("");
  const [savesSent, setSavesSent] = createSignal(false);
  const [customSmtpEnabled, setCustomSmtpEnabled] = createSignal(false);
  const [customSmtpHost, setCustomSmtpHost] = createSignal("");
  const [customSmtpPort, setCustomSmtpPort] = createSignal(587);
  const [customSmtpTlsMode, setCustomSmtpTlsMode] = createSignal<"implicit" | "starttls">("starttls");
  const [customSmtpUsername, setCustomSmtpUsername] = createSignal("");
  const [customSmtpPassword, setCustomSmtpPassword] = createSignal("");
  const [editorBaseline, setEditorBaseline] = createSignal("");

  createEffect(() => setIdentities(props.admin.identities));

  const selectableFolders = createMemo(() =>
    props.admin.folders.filter((folder) => folder.selectable && folder.discoveryState === "active"),
  );
  const activeBindings = createMemo(() => props.admin.bindings.filter((binding) => binding.state === "active"));
  const mailboxSignatures = createMemo(() =>
    props.mailboxSignatures.filter((template) => template.kind === "signature" && template.scope === "mailbox"),
  );
  const editingIdentity = createMemo(() => {
    const current = editor();
    return current?.kind === "edit" ? current.identity : null;
  });
  const editorValue = () =>
    JSON.stringify({
      kind: editor()?.kind ?? null,
      label: label(),
      displayName: displayName(),
      address: address(),
      replyTo: replyTo(),
      defaultCc: defaultCc(),
      defaultBcc: defaultBcc(),
      defaultFormat: defaultFormat(),
      defaultPriority: defaultPriority(),
      defaultDeliveryReceipt: defaultDeliveryReceipt(),
      defaultReadReceipt: defaultReadReceipt(),
      vcard: vcard(),
      envelopeSender: envelopeSender(),
      defaultSignatureTemplateId: defaultSignatureTemplateId(),
      sentFolderId: sentFolderId(),
      draftsFolderId: draftsFolderId(),
      isDefault: isDefault(),
      allowAutomation: allowAutomation(),
      bindingId: bindingId(),
      recipient: recipient(),
      savesSent: savesSent(),
      customSmtpEnabled: customSmtpEnabled(),
      customSmtpHost: customSmtpHost(),
      customSmtpPort: customSmtpPort(),
      customSmtpTlsMode: customSmtpTlsMode(),
      customSmtpUsername: customSmtpUsername(),
      customSmtpPassword: customSmtpPassword(),
    });
  const editorDirty = () => editor() !== null && editorValue() !== editorBaseline();
  const captureEditorBaseline = () => setEditorBaseline(editorValue());
  const closeEditor = async () => {
    if (!(await confirmDiscardIfDirty(editorDirty))) return;
    setEditor(null);
  };

  createEffect(() => props.onDirtyChange?.(editorDirty()));
  onCleanup(() => props.onDirtyChange?.(false));
  const replaceIdentity = (identity: SenderIdentity) =>
    setIdentities((current) =>
      current.some((item) => item.id === identity.id)
        ? current.map((item) => (item.id === identity.id ? identity : item))
        : [...current, identity],
    );

  const openCreate = () => {
    setLabel(props.admin.connections[0]?.name ?? props.admin.connections[0]?.email ?? "New identity");
    setDisplayName("");
    setAddress(props.admin.connections[0]?.email ?? props.currentUserEmail ?? "");
    setReplyTo("");
    setDefaultCc([]);
    setDefaultBcc([]);
    setDefaultFormat("markdown");
    setDefaultPriority("normal");
    setDefaultDeliveryReceipt(false);
    setDefaultReadReceipt(false);
    setVcard(null);
    setVcardError(null);
    setEnvelopeSender("");
    setDefaultSignatureTemplateId("");
    setSentFolderId(selectableFolders().find((folder) => folder.role === "sent")?.id ?? "");
    setDraftsFolderId(selectableFolders().find((folder) => folder.role === "drafts")?.id ?? "");
    setIsDefault(identities().length === 0);
    setAllowAutomation(true);
    setCustomSmtpEnabled(false);
    setCustomSmtpHost("");
    setCustomSmtpPort(587);
    setCustomSmtpTlsMode("starttls");
    setCustomSmtpUsername("");
    setCustomSmtpPassword("");
    setEditor({ kind: "create" });
    captureEditorBaseline();
  };

  const openEdit = (identity: SenderIdentity) => {
    setLabel(identity.label);
    setDisplayName(identity.displayName);
    setAddress(identity.fromAddress);
    setReplyTo(identity.replyTo ?? "");
    setDefaultCc(formatMailRecipients(identity.defaultCc));
    setDefaultBcc(formatMailRecipients(identity.defaultBcc));
    setDefaultFormat(identity.defaultFormat);
    setDefaultPriority(identity.defaultPriority);
    setDefaultDeliveryReceipt(identity.defaultDeliveryReceipt);
    setDefaultReadReceipt(identity.defaultReadReceipt);
    setVcard(identity.vcard);
    setVcardError(null);
    setEnvelopeSender(identity.envelopeSender ?? "");
    setDefaultSignatureTemplateId(identity.defaultSignatureTemplateId ?? "");
    setSentFolderId(identity.sentFolderId ?? "");
    setDraftsFolderId(identity.draftsFolderId ?? "");
    setIsDefault(identity.isDefault);
    setAllowAutomation(identity.authenticationPolicy.automation === "mailbox");
    setCustomSmtpEnabled(identity.transport.mode === "custom");
    setCustomSmtpHost(identity.transport.host ?? "");
    setCustomSmtpPort(identity.transport.port ?? 587);
    setCustomSmtpTlsMode(identity.transport.tlsMode ?? "starttls");
    setCustomSmtpUsername(identity.transport.username ?? "");
    setCustomSmtpPassword("");
    setEditor({ kind: "edit", identity });
    captureEditorBaseline();
  };

  const openVerify = (identity: SenderIdentity) => {
    setBindingId(activeBindings()[0]?.id ?? "");
    setRecipient(props.currentUserEmail ?? identity.fromAddress);
    setSavesSent(false);
    setEditor({ kind: "verify", identity });
    captureEditorBaseline();
  };

  const createIdentity = mutation.create<SenderIdentity, void>({
    mutation: async (_input, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"]["sender-identities"].$post(
        {
          param: { mailboxId: props.mailbox.id },
          json: {
            label: label().trim(),
            displayName: displayName().trim(),
            fromAddress: address().trim(),
            replyTo: replyTo().trim() || null,
            defaultCc: parseMailRecipients(defaultCc()),
            defaultBcc: parseMailRecipients(defaultBcc()),
            defaultFormat: defaultFormat(),
            defaultPriority: defaultPriority(),
            defaultDeliveryReceipt: defaultDeliveryReceipt(),
            defaultReadReceipt: defaultReadReceipt(),
            vcard: vcard(),
            envelopeSender: envelopeSender().trim() || null,
            defaultSignatureTemplateId: defaultSignatureTemplateId() || null,
            authenticationPolicy: { automation: allowAutomation() ? "mailbox" : "disabled" },
            sentFolderId: sentFolderId() || null,
            draftsFolderId: draftsFolderId() || null,
            isDefault: isDefault(),
          },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Failed to add identity"));
      return response.json();
    },
    onSuccess: (identity) => {
      replaceIdentity(identity);
      toast.success("Identity added");
      setEditor(null);
      setEditorBaseline("");
      props.onWorkspaceChange();
      void props.onReload();
    },
    onError: (error) => prompts.error(error.message),
  });

  const updateIdentity = mutation.create<SenderIdentity, void>({
    mutation: async (_input, { abortSignal }) => {
      const current = editor();
      if (!current || current.kind !== "edit") throw new Error("No identity selected");
      const response = await apiClient.mailboxes[":mailboxId"]["sender-identities"][":senderIdentityId"].$patch(
        {
          param: { mailboxId: props.mailbox.id, senderIdentityId: current.identity.id },
          json: {
            label: label().trim(),
            displayName: displayName().trim(),
            fromAddress: address().trim(),
            replyTo: replyTo().trim() || null,
            defaultCc: parseMailRecipients(defaultCc()),
            defaultBcc: parseMailRecipients(defaultBcc()),
            defaultFormat: defaultFormat(),
            defaultPriority: defaultPriority(),
            defaultDeliveryReceipt: defaultDeliveryReceipt(),
            defaultReadReceipt: defaultReadReceipt(),
            vcard: vcard(),
            envelopeSender: envelopeSender().trim() || null,
            defaultSignatureTemplateId: defaultSignatureTemplateId() || null,
            authenticationPolicy: { automation: allowAutomation() ? "mailbox" : "disabled" },
            sentFolderId: sentFolderId() || null,
            draftsFolderId: draftsFolderId() || null,
            isDefault: isDefault(),
          },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Failed to update identity"));
      return response.json();
    },
    onSuccess: (identity) => {
      replaceIdentity(identity);
      toast.success("Identity updated");
      setEditor(null);
      setEditorBaseline("");
      props.onWorkspaceChange();
      void props.onReload();
    },
    onError: (error) => prompts.error(error.message),
  });

  const replaceTransport = (transport: SenderIdentityTransport) => {
    const current = editor();
    if (!current || current.kind !== "edit") return;
    const identity = { ...current.identity, transport };
    replaceIdentity(identity);
    setEditor({ kind: "edit", identity });
    setCustomSmtpPassword("");
    captureEditorBaseline();
  };

  const saveCustomSmtp = mutation.create<SenderIdentityTransport, void>({
    mutation: async (_input, { abortSignal }) => {
      const current = editor();
      if (!current || current.kind !== "edit") throw new Error("Save the identity before configuring a custom SMTP server");
      if (!customSmtpHost().trim() || !customSmtpUsername().trim()) {
        throw new Error("SMTP host and username are required");
      }
      if (current.identity.transport.mode !== "custom" && !customSmtpPassword()) {
        throw new Error("Enter the SMTP password");
      }
      const response = await apiClient.mailboxes[":mailboxId"]["sender-identities"][":senderIdentityId"].transport.$put(
        {
          param: { mailboxId: props.mailbox.id, senderIdentityId: current.identity.id },
          json: {
            expectedRevision: current.identity.transport.revision,
            host: customSmtpHost().trim(),
            port: customSmtpPort(),
            tlsMode: customSmtpTlsMode(),
            username: customSmtpUsername().trim(),
            ...(customSmtpPassword() ? { secret: { kind: "password" as const, password: customSmtpPassword() } } : {}),
          },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "SMTP server could not be saved"));
      return response.json();
    },
    onSuccess: (transport) => {
      replaceTransport(transport);
      toast.success("SMTP server verified and saved");
      props.onWorkspaceChange();
    },
    onError: (error) => prompts.error(error.message),
  });

  const removeCustomSmtp = mutation.create<SenderIdentityTransport | null, void>({
    mutation: async (_input, { abortSignal }) => {
      const current = editor();
      if (!current || current.kind !== "edit") throw new Error("No identity selected");
      const confirmed = await prompts.confirm("New messages using this identity will be sent through the mailbox connection.", {
        title: "Use the mailbox SMTP server?",
        confirmText: "Use mailbox SMTP",
      });
      if (!confirmed || abortSignal.aborted) return null;
      const response = await apiClient.mailboxes[":mailboxId"]["sender-identities"][":senderIdentityId"].transport.$delete(
        {
          param: { mailboxId: props.mailbox.id, senderIdentityId: current.identity.id },
          json: { expectedRevision: current.identity.transport.revision },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Custom SMTP server could not be removed"));
      return response.json();
    },
    onSuccess: (transport) => {
      if (!transport) return;
      replaceTransport(transport);
      setCustomSmtpEnabled(false);
      setCustomSmtpHost("");
      setCustomSmtpUsername("");
      toast.success("Mailbox SMTP server selected");
      props.onWorkspaceChange();
    },
    onError: (error) => prompts.error(error.message),
  });

  const disableIdentity = mutation.create<{ disabled: boolean; identity: SenderIdentity }, SenderIdentity>({
    mutation: async (identity, { abortSignal }) => {
      const confirmed = await prompts.confirm(
        "Existing sent mail remains unchanged. This address can no longer be selected for new messages or automatic replies.",
        { title: `Disable ${identity.label}?`, confirmText: "Disable identity", variant: "danger" },
      );
      if (!confirmed || abortSignal.aborted) return { disabled: false, identity };
      const response = await apiClient.mailboxes[":mailboxId"]["sender-identities"][":senderIdentityId"].$delete(
        { param: { mailboxId: props.mailbox.id, senderIdentityId: identity.id } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Failed to disable identity"));
      return { disabled: true, identity };
    },
    onSuccess: async ({ disabled, identity }) => {
      if (!disabled) return;
      setIdentities((current) => current.filter((item) => item.id !== identity.id));
      setEditor(null);
      setEditorBaseline("");
      toast.success("Identity disabled");
      props.onWorkspaceChange();
      await props.onReload();
    },
    onError: (error) => prompts.error(error.message),
  });

  const verifyIdentity = mutation.create<SenderIdentity, void>({
    mutation: async (_input, { abortSignal }) => {
      const current = editor();
      if (!current || current.kind !== "verify") throw new Error("No identity selected");
      const response = await apiClient.mailboxes[":mailboxId"]["sender-identities"][":senderIdentityId"].verify.$post(
        {
          param: { mailboxId: props.mailbox.id, senderIdentityId: current.identity.id },
          json: { bindingId: bindingId(), verificationRecipient: recipient().trim(), savesSentAutomatically: savesSent() },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Sender verification failed"));
      return response.json();
    },
    onSuccess: (identity) => {
      replaceIdentity(identity);
      toast.success("Identity verified");
      setEditor(null);
      setEditorBaseline("");
      props.onWorkspaceChange();
      void props.onReload();
    },
    onError: (error) => prompts.error(error.message),
  });
  onCleanup(() => {
    createIdentity.abort();
    updateIdentity.abort();
    saveCustomSmtp.abort();
    removeCustomSmtp.abort();
    disableIdentity.abort();
    verifyIdentity.abort();
  });

  return (
    <Show
      when={editor()}
      fallback={
        <div class="flex flex-col gap-2">
          <button type="button" class="btn-secondary btn-sm self-end" disabled={props.reloading} onClick={openCreate}>
            <i class="ti ti-plus" aria-hidden="true" /> Add identity
          </button>
          <Show
            when={identities().length > 0}
            fallback={
              <Placeholder
                title="No identities"
                description="Add an identity for new messages, replies, and forwards."
                icon="ti ti-at-off"
              />
            }
          >
            <div class="flex flex-col gap-1">
              <For each={identities()}>
                {(identity) => (
                  <div class="group flex min-h-12 items-center gap-3 rounded-[var(--ui-radius-control)] px-2 py-2 hover:bg-[var(--ui-hover)]">
                    <i class="ti ti-at shrink-0 text-secondary" aria-hidden="true" />
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-sm font-medium text-primary">{identity.label}</span>
                      <span class="block truncate text-xs text-dimmed">{identity.fromAddress}</span>
                    </span>
                    <Show when={identity.isDefault}>
                      <span class="badge">Default</span>
                    </Show>
                    <span class="badge capitalize">{identity.status === "verified" ? "Ready" : identity.status.replaceAll("_", " ")}</span>
                    <Show when={identity.authenticationPolicy.automation === "mailbox"}>
                      <span class="badge">Automatic replies</span>
                    </Show>
                    <Show when={identity.status === "unverified" || identity.status === "rejected"}>
                      <button
                        type="button"
                        class="btn-secondary btn-sm"
                        disabled={activeBindings().length === 0 || props.reloading}
                        onClick={() => openVerify(identity)}
                      >
                        Verify
                      </button>
                    </Show>
                    <button
                      type="button"
                      class="icon-btn opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                      aria-label={`Edit ${identity.label}`}
                      onClick={() => openEdit(identity)}
                    >
                      <i class="ti ti-edit" aria-hidden="true" />
                    </button>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      }
    >
      {(currentEditor) => (
        <div class="flex flex-col gap-2">
          <Show
            when={currentEditor().kind !== "verify"}
            fallback={
              <>
                <EditorHeading
                  title="Verify identity"
                  description={`Confirm that the provider accepts messages sent with ${(currentEditor() as Extract<IdentityEditor, { kind: "verify" }>).identity.label}.`}
                  onBack={closeEditor}
                />
                <div class="info-block-info flex items-start gap-2 text-xs">
                  <i class="ti ti-info-circle mt-0.5 shrink-0" aria-hidden="true" />
                  <p>
                    Mail sends a real test message through this provider. The identity is ready to use only after the provider accepts its
                    From address and delivery settings.
                  </p>
                </div>
                <Select
                  label="Connected account"
                  value={bindingId}
                  onChange={setBindingId}
                  options={activeBindings().map((binding) => ({ id: binding.id, label: binding.authenticatedPrincipal ?? binding.id }))}
                  required
                />
                <TextInput label="Verification recipient" type="email" value={recipient} onInput={setRecipient} required />
                <Switch label="Provider saves sent mail automatically" value={savesSent} onChange={setSavesSent} />
                <div class="sticky bottom-0 flex justify-end gap-2 bg-[var(--ui-surface)] py-2">
                  <button type="button" class="btn-simple btn-sm" disabled={verifyIdentity.loading()} onClick={() => void closeEditor()}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    class="btn-primary btn-sm"
                    disabled={!bindingId() || !recipient().trim() || verifyIdentity.loading()}
                    onClick={() => verifyIdentity.mutate()}
                  >
                    <i class={verifyIdentity.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-shield-check"} aria-hidden="true" />
                    Send verification
                  </button>
                </div>
              </>
            }
          >
            <EditorHeading
              title={currentEditor().kind === "edit" ? "Edit identity" : "Add identity"}
              description="Configure one selectable sending context for collaborators."
              onBack={closeEditor}
            />
            <Show when={editingIdentity()}>
              {(identity) => (
                <Show
                  when={identity().status === "verified"}
                  fallback={
                    <div class="info-block-warning flex items-center justify-between gap-3 text-xs" role="status">
                      <span class="flex min-w-0 items-start gap-2">
                        <i class="ti ti-alert-circle mt-0.5 shrink-0" aria-hidden="true" />
                        <span>
                          This identity is not ready to send. Verify that the provider accepts its From address and delivery settings.
                        </span>
                      </span>
                      <button
                        type="button"
                        class="btn-secondary btn-sm shrink-0"
                        disabled={activeBindings().length === 0 || props.reloading}
                        onClick={() => openVerify(identity())}
                      >
                        Verify identity
                      </button>
                    </div>
                  }
                >
                  <div class="info-block-success flex items-start gap-2 text-xs" role="status">
                    <i class="ti ti-circle-check mt-0.5 shrink-0" aria-hidden="true" />
                    <p>Ready to send. The provider accepted a test message with this identity.</p>
                  </div>
                </Show>
              )}
            </Show>
            <TextInput
              label="Identity label"
              description="The private name collaborators see in identity pickers."
              value={label}
              onInput={setLabel}
              required
            />
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <TextInput label="Display name" description="The name recipients see." value={displayName} onInput={setDisplayName} />
              <TextInput
                label="From address"
                description="The address recipients see."
                type="email"
                value={address}
                onInput={setAddress}
                required
              />
            </div>
            <TextInput
              label="Reply-to address"
              description="Optional address for recipient replies."
              type="email"
              value={replyTo}
              onInput={setReplyTo}
            />
            <div>
              <p class="text-sm font-medium text-primary">Default Cc</p>
              <p class="mb-1 text-xs text-dimmed">
                Added to new interactive drafts that use this identity. Writers can remove recipients before sending.
              </p>
              <MailRecipientInput
                value={defaultCc}
                onChange={setDefaultCc}
                placeholder="Add default Cc recipient"
                disabled={createIdentity.loading() || updateIdentity.loading()}
              />
            </div>
            <div>
              <p class="text-sm font-medium text-primary">Default Bcc</p>
              <p class="mb-1 text-xs text-dimmed">
                Added privately to new interactive drafts. Other recipients do not see these addresses.
              </p>
              <MailRecipientInput
                value={defaultBcc}
                onChange={setDefaultBcc}
                placeholder="Add default Bcc recipient"
                disabled={createIdentity.loading() || updateIdentity.loading()}
              />
            </div>
            <details class="group rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)]">
              <summary class="focus-ui flex cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--ui-radius-control)] px-3 py-2.5 text-sm font-medium text-primary">
                <span class="flex items-center gap-2">
                  <i class="ti ti-pencil" aria-hidden="true" />
                  Writing defaults
                </span>
                <i class="ti ti-chevron-down transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div class="flex flex-col gap-2 px-3 pb-3">
                <Select
                  label="Default signature"
                  description="Inserted into new messages unless a writer has a personal override."
                  value={defaultSignatureTemplateId}
                  onChange={setDefaultSignatureTemplateId}
                  options={mailboxSignatures().map((template) => ({ id: template.id, label: template.name }))}
                  clearable
                />
                <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Select
                    label="Message format"
                    description="Writers can change this for each draft."
                    value={defaultFormat}
                    onChange={(value) => setDefaultFormat(value === "plain" ? "plain" : "markdown")}
                    options={[
                      { id: "markdown", label: "Markdown", icon: "ti ti-markdown" },
                      { id: "plain", label: "Plain text", icon: "ti ti-align-left" },
                    ]}
                  />
                  <Select
                    label="Priority"
                    description="Normal is appropriate for most messages."
                    value={defaultPriority}
                    onChange={(value) => setDefaultPriority(value === "high" ? "high" : value === "low" ? "low" : "normal")}
                    options={[
                      { id: "normal", label: "Normal" },
                      { id: "high", label: "High", icon: "ti ti-arrow-up" },
                      { id: "low", label: "Low", icon: "ti ti-arrow-down" },
                    ]}
                  />
                </div>
              </div>
            </details>
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <CheckboxCard
                label="Default identity"
                description="Preselected when Mail cannot determine a more specific identity."
                icon="ti ti-star"
                value={isDefault}
                onChange={setIsDefault}
              />
              <CheckboxCard
                label="Allow automatic replies"
                description="Rules may use this identity. No message is sent until a rule is explicitly enabled."
                icon="ti ti-message-reply"
                value={allowAutomation}
                onChange={setAllowAutomation}
              />
            </div>
            <details class="group rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)]">
              <summary class="focus-ui flex cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--ui-radius-control)] px-3 py-2.5 text-sm font-medium text-primary">
                <span class="flex items-center gap-2">
                  <i class="ti ti-adjustments" aria-hidden="true" />
                  Advanced delivery
                </span>
                <i class="ti ti-chevron-down transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div class="flex flex-col gap-2 px-3 pb-3">
                <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <CheckboxCard
                    label="Request delivery receipts"
                    description="Ask the sending server for delivery or failure reports. Servers may ignore the request."
                    icon="ti ti-mail-check"
                    variant="input"
                    value={defaultDeliveryReceipt}
                    onChange={setDefaultDeliveryReceipt}
                  />
                  <CheckboxCard
                    label="Request read receipts"
                    description="Ask recipients for a read receipt. This is never proof that a message was read."
                    icon="ti ti-eye-check"
                    variant="input"
                    value={defaultReadReceipt}
                    onChange={setDefaultReadReceipt}
                  />
                </div>
                <TextInput
                  label="Return-path address"
                  description="Optional technical address for delivery failures. Leave empty unless your mail provider requires a separate bounce address."
                  type="email"
                  value={envelopeSender}
                  onInput={setEnvelopeSender}
                />
                <Select
                  label="Sent folder"
                  description="Required when the provider does not save submitted mail automatically."
                  value={sentFolderId}
                  onChange={setSentFolderId}
                  options={selectableFolders().map((folder) => ({ id: folder.id, label: folder.name, icon: "ti ti-folder" }))}
                  clearable
                />
                <Select
                  label="Drafts folder"
                  description="Provider folder used for projected drafts."
                  value={draftsFolderId}
                  onChange={setDraftsFolderId}
                  options={selectableFolders().map((folder) => ({ id: folder.id, label: folder.name, icon: "ti ti-folder" }))}
                  clearable
                />
                <Show
                  when={vcard()}
                  fallback={
                    <FileDropzone
                      label="Contact card"
                      description="Optionally attach one .vcf contact card to messages sent with this identity."
                      accept=".vcf,text/vcard,text/x-vcard"
                      multiple={false}
                      icon="ti ti-address-book"
                      title="Choose a vCard"
                      subtitle="VCF, up to 256 KB"
                      class="min-h-20 py-3"
                      error={vcardError}
                      onDrop={async ([file]) => {
                        setVcardError(null);
                        if (!file) return;
                        if (file.size > 256 * 1024) {
                          setVcardError("Choose a vCard smaller than 256 KB");
                          return;
                        }
                        try {
                          const value = await file.text();
                          const normalized = value.replaceAll("\r\n", "\n").trim();
                          if (!normalized.startsWith("BEGIN:VCARD\n") || !normalized.endsWith("\nEND:VCARD")) {
                            setVcardError("Choose a complete vCard file");
                            return;
                          }
                          setVcard(value);
                        } catch {
                          setVcardError("The vCard could not be read");
                        }
                      }}
                    />
                  }
                >
                  <div class="flex items-center gap-3 rounded-[var(--ui-radius-control)] bg-[var(--ui-surface)] px-3 py-2">
                    <i class="ti ti-address-book shrink-0 text-secondary" aria-hidden="true" />
                    <span class="min-w-0 flex-1">
                      <span class="block text-sm font-medium text-primary">Contact card attached</span>
                      <span class="block text-xs text-dimmed">A vCard is added to every message from this identity.</span>
                    </span>
                    <button type="button" class="icon-btn" aria-label="Remove contact card" onClick={() => setVcard(null)}>
                      <i class="ti ti-x" aria-hidden="true" />
                    </button>
                  </div>
                </Show>
                <Show when={editingIdentity()}>
                  {(identity) => (
                    <div class="flex flex-col gap-2 rounded-[var(--ui-radius-control)] bg-[var(--ui-surface)] p-3">
                      <CheckboxCard
                        label="Use a separate SMTP server"
                        description="Only sending uses this server. Mailbox sync and sent-message storage continue through the connected account."
                        icon="ti ti-server"
                        variant="input"
                        value={customSmtpEnabled}
                        onChange={setCustomSmtpEnabled}
                      />
                      <Show when={customSmtpEnabled()}>
                        <div class="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_8rem]">
                          <TextInput label="SMTP host" value={customSmtpHost} onInput={setCustomSmtpHost} required />
                          <NumberInput label="Port" value={customSmtpPort} onChange={setCustomSmtpPort} min={1} max={65_535} required />
                        </div>
                        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <Select
                            label="Connection security"
                            value={customSmtpTlsMode}
                            onChange={(value) => setCustomSmtpTlsMode(value === "implicit" ? "implicit" : "starttls")}
                            options={[
                              { id: "starttls", label: "STARTTLS" },
                              { id: "implicit", label: "TLS" },
                            ]}
                          />
                          <TextInput label="Username" value={customSmtpUsername} onInput={setCustomSmtpUsername} required />
                        </div>
                        <TextInput
                          label="Password"
                          description={
                            identity().transport.mode === "custom"
                              ? "Leave empty to keep the stored password."
                              : "Encrypted and never shown again."
                          }
                          password
                          value={customSmtpPassword}
                          onInput={setCustomSmtpPassword}
                          required={identity().transport.mode !== "custom"}
                        />
                        <div class="flex justify-end">
                          <button
                            type="button"
                            class="btn-secondary btn-sm"
                            disabled={
                              saveCustomSmtp.loading() ||
                              !customSmtpHost().trim() ||
                              !customSmtpUsername().trim() ||
                              (identity().transport.mode !== "custom" && !customSmtpPassword())
                            }
                            onClick={() => saveCustomSmtp.mutate()}
                          >
                            <i class={saveCustomSmtp.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-shield-check"} aria-hidden="true" />
                            Verify and save SMTP
                          </button>
                        </div>
                      </Show>
                      <Show when={!customSmtpEnabled() && identity().transport.mode === "custom"}>
                        <div class="flex justify-end">
                          <button
                            type="button"
                            class="btn-secondary btn-sm"
                            disabled={removeCustomSmtp.loading()}
                            onClick={() => removeCustomSmtp.mutate()}
                          >
                            <i class={removeCustomSmtp.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-server-off"} aria-hidden="true" />
                            Use mailbox SMTP
                          </button>
                        </div>
                      </Show>
                    </div>
                  )}
                </Show>
              </div>
            </details>
            <div class="sticky bottom-0 flex items-center justify-between gap-2 bg-[var(--ui-surface)] py-2">
              <Show when={editingIdentity()} fallback={<span />}>
                {(identity) => (
                  <button
                    type="button"
                    class="btn-danger btn-sm"
                    disabled={disableIdentity.loading() || updateIdentity.loading()}
                    onClick={() => disableIdentity.mutate(identity())}
                  >
                    <i class={disableIdentity.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-trash"} aria-hidden="true" />
                    Disable identity
                  </button>
                )}
              </Show>
              <span class="flex items-center justify-end gap-2">
                <button
                  type="button"
                  class="btn-simple btn-sm"
                  disabled={createIdentity.loading() || updateIdentity.loading()}
                  onClick={() => void closeEditor()}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  class="btn-primary btn-sm"
                  disabled={
                    !label().trim() || !address().trim() || Boolean(vcardError()) || createIdentity.loading() || updateIdentity.loading()
                  }
                  onClick={() => (currentEditor().kind === "edit" ? updateIdentity.mutate() : createIdentity.mutate())}
                >
                  <i
                    class={
                      createIdentity.loading() || updateIdentity.loading()
                        ? "ti ti-loader-2 animate-spin"
                        : currentEditor().kind === "edit"
                          ? "ti ti-device-floppy"
                          : "ti ti-plus"
                    }
                    aria-hidden="true"
                  />
                  {currentEditor().kind === "edit" ? "Save identity" : "Add identity"}
                </button>
              </span>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}
