import { Checkbox, NumberInput, Placeholder, prompts, Select, Switch, TextInput, toast } from "@valentinkolb/cloud/ui";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type { ConnectionOwner, Mailbox, SenderIdentity } from "../../contracts";
import type { MailboxAdminSettingsContext } from "../../settings-context";
import { readApiError } from "./api-response";

type ProviderSettingsProps = {
  mailbox: Mailbox;
  admin: MailboxAdminSettingsContext;
  currentUserId: string;
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
  const [rootPath, setRootPath] = createSignal("");
  const [createSender, setCreateSender] = createSignal(true);

  const resetEditor = () => {
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
    setRootPath("");
    setCreateSender(true);
  };

  const canSubmit = createMemo(
    () =>
      Boolean(name().trim() && email().trim() && username().trim() && imapHost().trim() && smtpHost().trim() && secret()) &&
      imapPort() >= 1 &&
      imapPort() <= 65_535 &&
      smtpPort() >= 1 &&
      smtpPort() <= 65_535,
  );

  const connect = mutation.create<{ requiresConfirmation: boolean; senderCreated: boolean }, void>({
    mutation: async () => {
      const owner: ConnectionOwner =
        props.mailbox.connectionPolicy === "shared_connection"
          ? { type: "mailbox", mailboxId: props.mailbox.id }
          : { type: "user", userId: props.currentUserId };
      const connectionResponse = await apiClient.connections.$post({
        json: {
          owner,
          connection: {
            name: name().trim(),
            email: email().trim(),
            username: username().trim(),
            imap: { host: imapHost().trim(), port: imapPort(), tlsMode: imapTls() },
            smtp: { host: smtpHost().trim(), port: smtpPort(), tlsMode: smtpTls() },
            secret: auth() === "oauth2" ? { kind: "oauth2", accessToken: secret() } : { kind: "password", password: secret() },
          },
        },
      });
      if (!connectionResponse.ok) throw new Error(await readApiError(connectionResponse, "Provider verification failed"));
      const created = await connectionResponse.json();
      const bindingResponse = await apiClient.mailboxes[":mailboxId"].bindings.$post({
        param: { mailboxId: props.mailbox.id },
        json: { connectionId: created.connection.id, rootPath: rootPath().trim() || null },
      });
      if (!bindingResponse.ok) throw new Error(await readApiError(bindingResponse, "Connection was stored but folder discovery failed"));
      const binding = await bindingResponse.json();
      let senderCreated = false;
      if (createSender() && !binding.requiresConfirmation) {
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
      if (result.requiresConfirmation) toast("Connection requires explicit scope confirmation");
      toast.success(result.senderCreated ? "Provider and default sender connected" : "Provider connected");
      setEditing(false);
      props.onWorkspaceChange();
      void props.onReload();
    },
    onError: (error) => {
      void props.onReload();
      prompts.error(error.message);
    },
  });

  const confirmBinding = mutation.create<boolean, string>({
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
            title="Connect provider"
            description="Verify IMAP and SMTP before storing the encrypted credential."
            onBack={() => setEditing(false)}
          />
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextInput label="Label" description="Shown only in mailbox settings." value={name} onInput={setName} required />
            <TextInput label="Email address" type="email" value={email} onInput={setEmail} required />
          </div>
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
          <TextInput
            label="Folder root"
            description="Optional IMAP root for a shared namespace or delegated folder."
            value={rootPath}
            onInput={setRootPath}
          />
          <Checkbox
            label="Create the default sender for this address"
            description="Recommended for normal mailboxes. Disable only when the remote folder and sender use different accounts."
            value={createSender}
            onChange={setCreateSender}
          />
          <div class="sticky bottom-0 flex justify-end gap-2 bg-[var(--ui-surface)] py-2">
            <button type="button" class="btn-simple btn-sm" disabled={connect.loading()} onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="button" class="btn-primary btn-sm" disabled={!canSubmit() || connect.loading()} onClick={() => connect.mutate()}>
              <i class={connect.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-plug-connected"} aria-hidden="true" />
              Verify and connect
            </button>
          </div>
        </div>
      }
    >
      <div class="flex flex-col gap-2">
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
        <Show
          when={props.admin.connections.length > 0}
          fallback={
            <Placeholder
              title="No provider connection"
              description="Connect an IMAP and SMTP provider to synchronize mail."
              icon="ti ti-plug-off"
            />
          }
        >
          <For each={props.admin.connections}>
            {(connection) => (
              <div class="paper flex items-center gap-3 p-3">
                <i class="ti ti-server text-lg text-dimmed" aria-hidden="true" />
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
        <For each={props.admin.bindings}>
          {(binding) => (
            <div class="paper flex items-center gap-3 p-3">
              <i class="ti ti-folders text-lg text-dimmed" aria-hidden="true" />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium">{binding.authenticatedPrincipal || "Remote mailbox"}</span>
                <span class="block text-xs text-dimmed">{binding.state}</span>
              </span>
              <Show when={binding.state === "pending"}>
                <button
                  type="button"
                  class="btn-warning btn-sm"
                  disabled={confirmBinding.loading() || props.reloading}
                  onClick={() => confirmBinding.mutate(binding.id)}
                >
                  Review
                </button>
              </Show>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}

type SenderEditor = { kind: "create" } | { kind: "verify"; identity: SenderIdentity };

export function MailSenderSettings(props: ProviderSettingsProps) {
  const [editor, setEditor] = createSignal<SenderEditor | null>(null);
  const [displayName, setDisplayName] = createSignal("");
  const [address, setAddress] = createSignal("");
  const [sentFolderId, setSentFolderId] = createSignal("");
  const [isDefault, setIsDefault] = createSignal(false);
  const [bindingId, setBindingId] = createSignal("");
  const [recipient, setRecipient] = createSignal("");
  const [savesSent, setSavesSent] = createSignal(false);

  const selectableFolders = createMemo(() => props.admin.folders.filter((folder) => folder.selectable));
  const activeBindings = createMemo(() => props.admin.bindings.filter((binding) => binding.state === "active"));

  const openCreate = () => {
    setDisplayName("");
    setAddress(props.admin.connections[0]?.email ?? props.currentUserEmail ?? "");
    setSentFolderId(selectableFolders().find((folder) => folder.role === "sent")?.id ?? "");
    setIsDefault(props.admin.identities.length === 0);
    setEditor({ kind: "create" });
  };

  const openVerify = (identity: SenderIdentity) => {
    setBindingId(activeBindings()[0]?.id ?? "");
    setRecipient(props.currentUserEmail ?? identity.fromAddress);
    setSavesSent(false);
    setEditor({ kind: "verify", identity });
  };

  const createIdentity = mutation.create<void, void>({
    mutation: async () => {
      const response = await apiClient.mailboxes[":mailboxId"]["sender-identities"].$post({
        param: { mailboxId: props.mailbox.id },
        json: {
          displayName: displayName().trim(),
          fromAddress: address().trim(),
          authenticationPolicy: {
            interactive: props.mailbox.connectionPolicy === "shared_connection" ? "mailbox" : "actor",
            automation: "disabled",
          },
          sentFolderId: sentFolderId() || null,
          isDefault: isDefault(),
        },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to add sender identity"));
    },
    onSuccess: () => {
      toast.success("Sender identity added");
      setEditor(null);
      props.onWorkspaceChange();
      void props.onReload();
    },
    onError: (error) => prompts.error(error.message),
  });

  const verifyIdentity = mutation.create<void, void>({
    mutation: async () => {
      const current = editor();
      if (!current || current.kind !== "verify") return;
      const response = await apiClient.mailboxes[":mailboxId"]["sender-identities"][":senderIdentityId"].verify.$post({
        param: { mailboxId: props.mailbox.id, senderIdentityId: current.identity.id },
        json: { bindingId: bindingId(), verificationRecipient: recipient().trim(), savesSentAutomatically: savesSent() },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Sender verification failed"));
    },
    onSuccess: () => {
      toast.success("Sender identity verified");
      setEditor(null);
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
            when={props.admin.identities.length > 0}
            fallback={
              <Placeholder
                title="No sender identities"
                description="Add a From address for new messages and replies."
                icon="ti ti-at-off"
              />
            }
          >
            <For each={props.admin.identities}>
              {(identity) => (
                <div class="paper flex items-center gap-3 p-3">
                  <i class="ti ti-user-circle text-lg text-dimmed" aria-hidden="true" />
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm font-medium">{identity.displayName || identity.fromAddress}</span>
                    <span class="block truncate text-xs text-dimmed">{identity.fromAddress}</span>
                  </span>
                  <span class="badge">{identity.status}</span>
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
            when={currentEditor().kind === "create"}
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
              title="Add sender"
              description="Configure the From address collaborators can use."
              onBack={() => setEditor(null)}
            />
            <TextInput label="Display name" description="The name recipients see." value={displayName} onInput={setDisplayName} />
            <TextInput label="From address" type="email" value={address} onInput={setAddress} required />
            <Select
              label="Sent folder"
              description="Required when the provider does not save submitted mail automatically."
              value={sentFolderId}
              onChange={setSentFolderId}
              options={selectableFolders().map((folder) => ({ id: folder.id, label: folder.name, icon: "ti ti-folder" }))}
              clearable
            />
            <Checkbox label="Default sender" value={isDefault} onChange={setIsDefault} />
            <div class="sticky bottom-0 flex justify-end gap-2 bg-[var(--ui-surface)] py-2">
              <button type="button" class="btn-simple btn-sm" disabled={createIdentity.loading()} onClick={() => setEditor(null)}>
                Cancel
              </button>
              <button
                type="button"
                class="btn-primary btn-sm"
                disabled={!address().trim() || createIdentity.loading()}
                onClick={() => createIdentity.mutate()}
              >
                <i class={createIdentity.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-plus"} aria-hidden="true" /> Add sender
              </button>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}
