import { Placeholder, prompts } from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { onMount, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type { Mailbox, MailWorkflow, ProviderBinding, ProviderConnection, SenderIdentity } from "../../contracts";
import type { MailFolderView } from "../../service/messages";
import { readApiError } from "./api-response";
import MailboxSettings from "./MailboxSettings";

type MailboxPermission = "read" | "write" | "admin";

export default function MailboxSettingsButton(props: {
  mailboxId: string;
  currentUserId: string;
  currentUserEmail: string | null;
  permission: MailboxPermission;
  class?: string;
  label?: string;
  autoOpen?: boolean;
  hideButton?: boolean;
  returnHref?: string;
}) {
  const open = mutations.create<void, void>({
    mutation: async () => {
      const [mailboxResponse, foldersResponse, identitiesResponse] = await Promise.all([
        apiClient.mailboxes[":mailboxId"].$get({ param: { mailboxId: props.mailboxId } }),
        apiClient.mailboxes[":mailboxId"].folders.$get({ param: { mailboxId: props.mailboxId } }),
        apiClient.mailboxes[":mailboxId"]["sender-identities"].$get({ param: { mailboxId: props.mailboxId } }),
      ]);
      if (!mailboxResponse.ok) throw new Error(await readApiError(mailboxResponse, "Failed to load mailbox settings"));
      if (!foldersResponse.ok) throw new Error(await readApiError(foldersResponse, "Failed to load mailbox folders"));
      if (!identitiesResponse.ok) throw new Error(await readApiError(identitiesResponse, "Failed to load sender identities"));

      const mailbox = (await mailboxResponse.json()) as Mailbox;
      const folders = (await foldersResponse.json()) as MailFolderView[];
      const identities = (await identitiesResponse.json()) as SenderIdentity[];
      let accessEntries: Parameters<typeof MailboxSettings>[0]["accessEntries"] = [];
      let connections: ProviderConnection[] = [];
      let bindings: ProviderBinding[] = [];
      let workflows: MailWorkflow[] = [];

      if (props.permission === "admin") {
        const [accessResponse, connectionsResponse, bindingsResponse, workflowsResponse] = await Promise.all([
          apiClient.mailboxes[":mailboxId"].access.$get({ param: { mailboxId: props.mailboxId } }),
          apiClient.connections.$get({ query: { mailboxId: props.mailboxId } }),
          apiClient.mailboxes[":mailboxId"].bindings.$get({ param: { mailboxId: props.mailboxId } }),
          apiClient.mailboxes[":mailboxId"].workflows.$get({ param: { mailboxId: props.mailboxId } }),
        ]);
        if (!accessResponse.ok) throw new Error(await readApiError(accessResponse, "Failed to load mailbox access"));
        if (!connectionsResponse.ok) throw new Error(await readApiError(connectionsResponse, "Failed to load provider connections"));
        if (!bindingsResponse.ok) throw new Error(await readApiError(bindingsResponse, "Failed to load provider bindings"));
        if (!workflowsResponse.ok) throw new Error(await readApiError(workflowsResponse, "Failed to load workflows"));
        accessEntries = await accessResponse.json();
        connections = await connectionsResponse.json();
        bindings = await bindingsResponse.json();
        workflows = await workflowsResponse.json();
      }

      await prompts.dialog<void>(
        (close) => (
          <MailboxSettings
            mailbox={mailbox}
            permission={props.permission}
            currentUserId={props.currentUserId}
            currentUserEmail={props.currentUserEmail}
            accessEntries={accessEntries}
            connections={connections}
            bindings={bindings}
            folders={folders}
            identities={identities}
            workflows={workflows}
            onClose={() => close()}
          />
        ),
        { surface: "bare", header: false, size: "large" },
      );
      if (props.returnHref) navigateTo(props.returnHref);
    },
    onError: (error) => prompts.error(error.message),
  });

  onMount(() => {
    if (props.autoOpen) open.mutate();
  });

  return (
    <Show when={!props.hideButton} fallback={<Placeholder state="loading" title="Opening mailbox settings" class="min-h-56" />}>
      <button type="button" class={props.class ?? "btn-secondary btn-sm"} disabled={open.loading()} onClick={() => open.mutate()}>
        <i class={`ti ${open.loading() ? "ti-loader-2 animate-spin" : "ti-settings"}`} aria-hidden="true" />
        {props.label ?? "Settings"}
      </button>
    </Show>
  );
}
