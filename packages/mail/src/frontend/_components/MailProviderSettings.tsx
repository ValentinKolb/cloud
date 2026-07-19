import { Checkbox, NumberInput, Placeholder, prompts, Select, Switch, TextInput, toast } from "@valentinkolb/cloud/ui";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type { Mailbox, SenderIdentity } from "../../contracts";
import type { DiscoveredMailConfiguration } from "../../service/onboarding-discovery";
import type { MailboxAdminSettingsContext } from "../../settings-context";
import { readApiError } from "./api-response";

type ProviderSettingsProps = {
  mailbox: Mailbox;
  admin: MailboxAdminSettingsContext;
  currentUserEmail: string | null;
  reloading: boolean;
  onReload: () => Promise<void>;
  onWorkspaceChange: () => void;
};

const EditorHeading = (props: { title: string; description: string; onBack: () => void }) => (
  <div class="flex items-start gap-2">
    <button type="button" class="icon-btn shrink-0" aria-label="Back" onClick={props.onBack}>
      <i class="ti ti-arrow-left" aria-hidden="true" />
    </button>
    <div class="min-w-0">
      <h3 class="text-sm font-semibold text-primary">{props.title}</h3>
      <p class="mt-1 text-xs text-dimmed">{props.description}</p>
    </div>
  </div>
);

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
  const [discoverySource, setDiscoverySource] = createSignal<string | null>(null);
  const currentConnection = createMemo(() => props.admin.connections.find((connection) => connection.status !== "revoked"));
  const currentBinding = createMemo(() => props.admin.bindings.find((binding) => binding.state !== "revoked"));

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
    setDiscoverySource(null);
  };

  const replaceEditor = () => {
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
    setDiscoverySource(null);
    setEditing(true);
  };

  const discover = mutation.create<DiscoveredMailConfiguration[], void>({
    mutation: async () => {
      const response = await apiClient.mailboxes[":mailboxId"]["provider-discovery"].$get({
        param: { mailboxId: props.mailbox.id },
        query: { email: email().trim() },
      });
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

  const attachConnection = async (connectionId: string): Promise<boolean> => {
    const bindingResponse = await apiClient.mailboxes[":mailboxId"].bindings.$post({
      param: { mailboxId: props.mailbox.id },
      json: { connectionId },
    });
    if (!bindingResponse.ok) throw new Error(await readApiError(bindingResponse, "Folder discovery failed"));
    const binding = await bindingResponse.json();
    if (!createSender()) return false;
    const senderResponse = await apiClient.mailboxes[":mailboxId"]["sender-identities"].default.setup.$post({
      param: { mailboxId: props.mailbox.id },
      json: { bindingId: binding.id, savesSentAutomatically: false },
    });
    if (!senderResponse.ok)
      throw new Error(await readApiError(senderResponse, "Provider connected, but the default sender could not be created"));
    return true;
  };

  const connect = mutation.create<{ senderCreated: boolean; replaced: boolean }, void>({
    mutation: async () => {
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
        ? await apiClient.mailboxes[":mailboxId"].connections[":connectionId"].$put({
            param: { mailboxId: props.mailbox.id, connectionId: replacementId },
            json: input,
          })
        : await apiClient.mailboxes[":mailboxId"].connections.$post({
            param: { mailboxId: props.mailbox.id },
            json: input,
          });
      if (!connectionResponse.ok) throw new Error(await readApiError(connectionResponse, "Provider verification failed"));
      const created = await connectionResponse.json();
      return replacementId
        ? { senderCreated: false, replaced: true }
        : { senderCreated: await attachConnection(created.connection.id), replaced: false };
    },
    onSuccess: (result) => {
      toast.success(
        result.replaced
          ? "Provider credentials replaced"
          : result.senderCreated
            ? "Provider and default sender connected"
            : "Provider connected",
      );
      setEditing(false);
      setReplacingConnectionId(null);
      props.onWorkspaceChange();
      void props.onReload();
    },
    onError: (error) => {
      void props.onReload();
      prompts.error(error.message);
    },
  });

  const revoke = mutation.create<boolean, string>({
    mutation: async (connectionId) => {
      const confirmed = await prompts.confirm(
        "This permanently removes the encrypted credential, revokes its remote mailbox binding, and stops provider operations until another connection is configured.",
        { title: "Remove provider connection?", confirmText: "Remove connection", variant: "danger" },
      );
      if (!confirmed) return false;
      const response = await apiClient.mailboxes[":mailboxId"].connections[":connectionId"].$delete({
        param: { mailboxId: props.mailbox.id, connectionId },
      });
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

  const finishSetup = mutation.create<{ senderCreated: boolean }, string>({
    mutation: async (connectionId) => ({ senderCreated: await attachConnection(connectionId) }),
    onSuccess: (result) => {
      toast.success(result.senderCreated ? "Provider and default sender connected" : "Provider connected");
      props.onWorkspaceChange();
      void props.onReload();
    },
    onError: (error) => prompts.error(error.message),
  });

  return (
    <Show
      when={!editing()}
      fallback={
        <div class="flex flex-col gap-4">
          <EditorHeading
            title={replacingConnectionId() ? "Replace provider credentials" : "Connect provider"}
            description={
              replacingConnectionId()
                ? "Enter the complete connection again. The new credential is verified before replacing the current one."
                : "Verify IMAP and SMTP before storing the encrypted credential."
            }
            onBack={() => setEditing(false)}
          />
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextInput label="Label" description="Shown only in mailbox settings." value={name} onInput={setName} required />
            <div class="flex items-end gap-2">
              <div class="min-w-0 flex-1">
                <TextInput label="Email address" type="email" value={email} onInput={setEmail} required />
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
          <TextInput label="Username" description="Login name sent to IMAP and SMTP." value={username} onInput={setUsername} required />
          <div>
            <p class="mb-2 text-xs font-semibold text-primary">Incoming mail</p>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_11rem]">
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
            <p class="mb-2 text-xs font-semibold text-primary">Outgoing mail</p>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_11rem]">
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
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              label="Authentication"
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
            <Checkbox
              label="Create the default sender for this address"
              description="Recommended for normal mailboxes. Disable only when the remote folder and sender use different accounts."
              value={createSender}
              onChange={setCreateSender}
            />
          </Show>
          <div class="sticky bottom-0 flex justify-end gap-2 bg-[var(--ui-surface)] py-2">
            <button type="button" class="btn-simple btn-sm" disabled={connect.loading()} onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="button" class="btn-primary btn-sm" disabled={!canSubmit() || connect.loading()} onClick={() => connect.mutate()}>
              <i class={connect.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-plug-connected"} aria-hidden="true" />
              {replacingConnectionId() ? "Verify and replace" : "Verify and connect"}
            </button>
          </div>
        </div>
      }
    >
      <div class="flex flex-col gap-2">
        <Show when={!currentConnection()}>
          <button
            type="button"
            class="btn-primary btn-sm self-start"
            disabled={props.reloading}
            onClick={() => {
              resetEditor();
              setEditing(true);
            }}
          >
            <i class="ti ti-plus" aria-hidden="true" /> Connect provider
          </button>
        </Show>
        <Show
          when={currentConnection()}
          fallback={
            <Placeholder
              title="No provider connection"
              description="Connect an IMAP and SMTP provider to synchronize mail."
              icon="ti ti-plug-off"
            />
          }
        >
          {(connection) => (
            <div class="paper flex items-center gap-3 p-3">
              <i class="ti ti-server text-lg text-dimmed" aria-hidden="true" />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium">{connection().name}</span>
                <span class="block truncate text-xs text-dimmed">
                  {connection().email} · {connection().imap.host}
                </span>
              </span>
              <span class="badge">{connection().status}</span>
              <button type="button" class="btn-secondary btn-sm" disabled={props.reloading || revoke.loading()} onClick={replaceEditor}>
                <i class="ti ti-key" aria-hidden="true" /> Replace
              </button>
              <button
                type="button"
                class="icon-btn text-red-600"
                aria-label="Remove provider connection"
                disabled={props.reloading || revoke.loading()}
                onClick={() => revoke.mutate(connection().id)}
              >
                <i class="ti ti-trash" aria-hidden="true" />
              </button>
              <Show when={!currentBinding()}>
                <button
                  type="button"
                  class="btn-secondary btn-sm"
                  disabled={finishSetup.loading() || props.reloading}
                  onClick={() => finishSetup.mutate(connection().id)}
                >
                  <i class={finishSetup.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-plug-connected"} aria-hidden="true" /> Finish
                  setup
                </button>
              </Show>
            </div>
          )}
        </Show>
        <Show when={currentBinding()}>
          {(binding) => (
            <div class="paper flex items-center gap-3 p-3">
              <i class="ti ti-folders text-lg text-dimmed" aria-hidden="true" />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium">{binding().authenticatedPrincipal || "Remote mailbox"}</span>
                <span class="block text-xs text-dimmed">{binding().state}</span>
              </span>
            </div>
          )}
        </Show>
      </div>
    </Show>
  );
}

type SenderEditor = { kind: "create" } | { kind: "edit"; identity: SenderIdentity } | { kind: "verify"; identity: SenderIdentity };

export function MailSenderSettings(props: ProviderSettingsProps) {
  const [editor, setEditor] = createSignal<SenderEditor | null>(null);
  const [identities, setIdentities] = createSignal(props.admin.identities);
  const [displayName, setDisplayName] = createSignal("");
  const [address, setAddress] = createSignal("");
  const [replyTo, setReplyTo] = createSignal("");
  const [envelopeSender, setEnvelopeSender] = createSignal("");
  const [sentFolderId, setSentFolderId] = createSignal("");
  const [draftsFolderId, setDraftsFolderId] = createSignal("");
  const [isDefault, setIsDefault] = createSignal(false);
  const [allowAutomation, setAllowAutomation] = createSignal(true);
  const [bindingId, setBindingId] = createSignal("");
  const [recipient, setRecipient] = createSignal("");
  const [savesSent, setSavesSent] = createSignal(false);

  createEffect(() => setIdentities(props.admin.identities));

  const selectableFolders = createMemo(() =>
    props.admin.folders.filter((folder) => folder.selectable && folder.discoveryState === "active"),
  );
  const activeBindings = createMemo(() => props.admin.bindings.filter((binding) => binding.state === "active"));
  const replaceIdentity = (identity: SenderIdentity) =>
    setIdentities((current) =>
      current.some((item) => item.id === identity.id)
        ? current.map((item) => (item.id === identity.id ? identity : item))
        : [...current, identity],
    );

  const openCreate = () => {
    setDisplayName("");
    setAddress(props.admin.connections[0]?.email ?? props.currentUserEmail ?? "");
    setReplyTo("");
    setEnvelopeSender("");
    setSentFolderId(selectableFolders().find((folder) => folder.role === "sent")?.id ?? "");
    setDraftsFolderId(selectableFolders().find((folder) => folder.role === "drafts")?.id ?? "");
    setIsDefault(identities().length === 0);
    setAllowAutomation(true);
    setEditor({ kind: "create" });
  };

  const openEdit = (identity: SenderIdentity) => {
    setDisplayName(identity.displayName);
    setAddress(identity.fromAddress);
    setReplyTo(identity.replyTo ?? "");
    setEnvelopeSender(identity.envelopeSender ?? "");
    setSentFolderId(identity.sentFolderId ?? "");
    setDraftsFolderId(identity.draftsFolderId ?? "");
    setIsDefault(identity.isDefault);
    setAllowAutomation(identity.authenticationPolicy.automation === "mailbox");
    setEditor({ kind: "edit", identity });
  };

  const openVerify = (identity: SenderIdentity) => {
    setBindingId(activeBindings()[0]?.id ?? "");
    setRecipient(props.currentUserEmail ?? identity.fromAddress);
    setSavesSent(false);
    setEditor({ kind: "verify", identity });
  };

  const createIdentity = mutation.create<SenderIdentity, void>({
    mutation: async () => {
      const response = await apiClient.mailboxes[":mailboxId"]["sender-identities"].$post({
        param: { mailboxId: props.mailbox.id },
        json: {
          displayName: displayName().trim(),
          fromAddress: address().trim(),
          replyTo: replyTo().trim() || null,
          envelopeSender: envelopeSender().trim() || null,
          authenticationPolicy: { automation: allowAutomation() ? "mailbox" : "disabled" },
          sentFolderId: sentFolderId() || null,
          draftsFolderId: draftsFolderId() || null,
          isDefault: isDefault(),
        },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to add sender identity"));
      return response.json();
    },
    onSuccess: (identity) => {
      replaceIdentity(identity);
      toast.success("Sender identity added");
      setEditor(null);
      props.onWorkspaceChange();
      void props.onReload();
    },
    onError: (error) => prompts.error(error.message),
  });

  const updateIdentity = mutation.create<SenderIdentity, void>({
    mutation: async () => {
      const current = editor();
      if (!current || current.kind !== "edit") throw new Error("No sender identity selected");
      const response = await apiClient.mailboxes[":mailboxId"]["sender-identities"][":senderIdentityId"].$patch({
        param: { mailboxId: props.mailbox.id, senderIdentityId: current.identity.id },
        json: {
          displayName: displayName().trim(),
          fromAddress: address().trim(),
          replyTo: replyTo().trim() || null,
          envelopeSender: envelopeSender().trim() || null,
          authenticationPolicy: { automation: allowAutomation() ? "mailbox" : "disabled" },
          sentFolderId: sentFolderId() || null,
          draftsFolderId: draftsFolderId() || null,
          isDefault: isDefault(),
        },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to update sender identity"));
      return response.json();
    },
    onSuccess: (identity) => {
      replaceIdentity(identity);
      toast.success("Sender identity updated");
      setEditor(null);
      props.onWorkspaceChange();
      void props.onReload();
    },
    onError: (error) => prompts.error(error.message),
  });

  const disableIdentity = mutation.create<{ disabled: boolean; identity: SenderIdentity }, SenderIdentity>({
    mutation: async (identity) => {
      const confirmed = await prompts.confirm(
        "Existing sent mail remains unchanged. This address can no longer be selected for new messages or automatic replies.",
        { title: `Disable ${identity.fromAddress}?`, confirmText: "Disable sender", variant: "danger" },
      );
      if (!confirmed) return { disabled: false, identity };
      const response = await apiClient.mailboxes[":mailboxId"]["sender-identities"][":senderIdentityId"].$delete({
        param: { mailboxId: props.mailbox.id, senderIdentityId: identity.id },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to disable sender identity"));
      return { disabled: true, identity };
    },
    onSuccess: async ({ disabled, identity }) => {
      if (!disabled) return;
      setIdentities((current) => current.filter((item) => item.id !== identity.id));
      toast.success("Sender identity disabled");
      props.onWorkspaceChange();
      await props.onReload();
    },
    onError: (error) => prompts.error(error.message),
  });

  const verifyIdentity = mutation.create<SenderIdentity, void>({
    mutation: async () => {
      const current = editor();
      if (!current || current.kind !== "verify") throw new Error("No sender identity selected");
      const response = await apiClient.mailboxes[":mailboxId"]["sender-identities"][":senderIdentityId"].verify.$post({
        param: { mailboxId: props.mailbox.id, senderIdentityId: current.identity.id },
        json: { bindingId: bindingId(), verificationRecipient: recipient().trim(), savesSentAutomatically: savesSent() },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Sender verification failed"));
      return response.json();
    },
    onSuccess: (identity) => {
      replaceIdentity(identity);
      toast.success("Sender identity verified");
      setEditor(null);
      props.onWorkspaceChange();
      void props.onReload();
    },
    onError: (error) => prompts.error(error.message),
  });

  const updateAutomation = mutation.create<SenderIdentity, { identity: SenderIdentity; enabled: boolean }>({
    mutation: async ({ identity, enabled }) => {
      const response = await apiClient.mailboxes[":mailboxId"]["sender-identities"][":senderIdentityId"].$patch({
        param: { mailboxId: props.mailbox.id, senderIdentityId: identity.id },
        json: { authenticationPolicy: { automation: enabled ? "mailbox" : "disabled" } },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to update automatic reply access"));
      return response.json();
    },
    onSuccess: (identity) => {
      replaceIdentity(identity);
      toast.success(
        identity.authenticationPolicy.automation === "mailbox"
          ? "Automatic replies enabled for sender"
          : "Automatic replies disabled for sender",
      );
      props.onWorkspaceChange();
      void props.onReload();
    },
    onError: (error) => prompts.error(error.message),
  });

  return (
    <Show
      when={editor()}
      fallback={
        <div class="flex flex-col gap-2">
          <button type="button" class="btn-primary btn-sm self-start" disabled={props.reloading} onClick={openCreate}>
            <i class="ti ti-plus" aria-hidden="true" /> Add sender
          </button>
          <Show
            when={identities().length > 0}
            fallback={
              <Placeholder
                title="No sender identities"
                description="Add a From address for new messages and replies."
                icon="ti ti-at-off"
              />
            }
          >
            <For each={identities()}>
              {(identity) => (
                <div class="paper flex items-center gap-3 p-3">
                  <i class="ti ti-user-circle text-lg text-dimmed" aria-hidden="true" />
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm font-medium">{identity.displayName || identity.fromAddress}</span>
                    <span class="block truncate text-xs text-dimmed">{identity.fromAddress}</span>
                  </span>
                  <span class="badge">{identity.status}</span>
                  <Switch
                    label="Automatic replies"
                    value={() => identity.authenticationPolicy.automation === "mailbox"}
                    disabled={identity.status !== "verified" || updateAutomation.loading() || props.reloading}
                    onChange={(enabled) => updateAutomation.mutate({ identity, enabled })}
                  />
                  <Show when={identity.status !== "verified"}>
                    <button
                      type="button"
                      class="btn-secondary btn-sm"
                      disabled={activeBindings().length === 0 || props.reloading}
                      onClick={() => openVerify(identity)}
                    >
                      Verify
                    </button>
                  </Show>
                  <button type="button" class="icon-btn" aria-label={`Edit ${identity.fromAddress}`} onClick={() => openEdit(identity)}>
                    <i class="ti ti-edit" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    class="icon-btn text-red-600"
                    aria-label={`Disable ${identity.fromAddress}`}
                    disabled={disableIdentity.loading()}
                    onClick={() => disableIdentity.mutate(identity)}
                  >
                    <i class="ti ti-trash" aria-hidden="true" />
                  </button>
                </div>
              )}
            </For>
          </Show>
        </div>
      }
    >
      {(currentEditor) => (
        <div class="flex flex-col gap-4">
          <Show
            when={currentEditor().kind !== "verify"}
            fallback={
              <>
                <EditorHeading
                  title="Verify sender"
                  description={`Send a real verification message for ${(currentEditor() as Extract<SenderEditor, { kind: "verify" }>).identity.fromAddress}.`}
                  onBack={() => setEditor(null)}
                />
                <Select
                  label="Provider binding"
                  value={bindingId}
                  onChange={setBindingId}
                  options={activeBindings().map((binding) => ({ id: binding.id, label: binding.authenticatedPrincipal ?? binding.id }))}
                  required
                />
                <TextInput label="Verification recipient" type="email" value={recipient} onInput={setRecipient} required />
                <Switch label="Provider saves sent mail automatically" value={savesSent} onChange={setSavesSent} />
                <div class="sticky bottom-0 flex justify-end gap-2 bg-[var(--ui-surface)] py-2">
                  <button type="button" class="btn-simple btn-sm" disabled={verifyIdentity.loading()} onClick={() => setEditor(null)}>
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
              title={currentEditor().kind === "edit" ? "Edit sender" : "Add sender"}
              description="Configure the sender collaborators and automatic replies can use."
              onBack={() => setEditor(null)}
            />
            <TextInput label="Display name" description="The name recipients see." value={displayName} onInput={setDisplayName} />
            <TextInput label="From address" type="email" value={address} onInput={setAddress} required />
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <TextInput
                label="Reply-to address"
                description="Optional address for recipient replies."
                type="email"
                value={replyTo}
                onInput={setReplyTo}
              />
              <TextInput
                label="Envelope sender"
                description="Optional return-path used for delivery."
                type="email"
                value={envelopeSender}
                onInput={setEnvelopeSender}
              />
            </div>
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
            <Checkbox label="Default sender" value={isDefault} onChange={setIsDefault} />
            <div>
              <Switch label="Allow automatic replies" value={allowAutomation} onChange={setAllowAutomation} />
              <p class="mt-1 text-xs text-dimmed">
                Enabled by default. Automatic replies still require an explicit mailbox rule before anything is sent.
              </p>
            </div>
            <div class="sticky bottom-0 flex justify-end gap-2 bg-[var(--ui-surface)] py-2">
              <button
                type="button"
                class="btn-simple btn-sm"
                disabled={createIdentity.loading() || updateIdentity.loading()}
                onClick={() => setEditor(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                class="btn-primary btn-sm"
                disabled={!address().trim() || createIdentity.loading() || updateIdentity.loading()}
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
                {currentEditor().kind === "edit" ? "Save sender" : "Add sender"}
              </button>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}
