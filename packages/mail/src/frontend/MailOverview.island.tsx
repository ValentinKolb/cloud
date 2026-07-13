import { AppOverview, prompts, TextInput, toast } from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { apiClient } from "../api/client";
import type { Mailbox } from "../contracts";
import { readApiError } from "./_components/api-response";

type MailboxWithPermission = Mailbox & { permission: "read" | "write" | "admin" };

export default function MailOverview(props: { mailboxes: MailboxWithPermission[]; initialQuery: string }) {
  const [query, setQuery] = createSignal(props.initialQuery);
  const filtered = createMemo(() => {
    const normalized = query().trim().toLowerCase();
    if (!normalized) return props.mailboxes;
    return props.mailboxes.filter((mailbox) => `${mailbox.name} ${mailbox.description ?? ""}`.toLowerCase().includes(normalized));
  });

  const createMailbox = mutations.create<Mailbox | null, void>({
    mutation: async () => {
      const values = await prompts.form({
        title: "New mailbox",
        icon: "ti ti-mail-plus",
        fields: {
          name: { type: "text", label: "Name", description: "The label everyone with access sees.", required: true },
          description: {
            type: "text",
            label: "Description",
            description: "Optional context for collaborators.",
            multiline: true,
            lines: 3,
          },
          policy: {
            type: "select",
            label: "Connection model",
            description: "Shared uses one mailbox credential; personal lets each collaborator connect independently.",
            default: "shared_connection",
            options: [
              { id: "shared_connection", label: "Shared connection", icon: "ti ti-users" },
              { id: "personal_provider_account", label: "Personal provider accounts", icon: "ti ti-user-lock" },
            ],
          },
        },
        confirmText: "Create mailbox",
      });
      if (!values) return null;
      const response = await apiClient.mailboxes.$post({
        json: {
          name: values.name,
          description: values.description || null,
          connectionPolicy: values.policy === "personal_provider_account" ? "personal_provider_account" : "shared_connection",
        },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to create mailbox"));
      return await response.json();
    },
    onSuccess: (mailbox) => {
      if (!mailbox) return;
      toast.success("Mailbox created");
      navigateTo(`/app/mail/${mailbox.id}/settings`);
    },
    onError: (error) => prompts.error(error.message),
  });

  const updateQuery = (value: string) => {
    setQuery(value);
    const url = new URL(window.location.href);
    if (value.trim()) url.searchParams.set("q", value.trim());
    else url.searchParams.delete("q");
    window.history.replaceState({}, "", url);
  };

  return (
    <AppOverview
      class="cloud-ui-soft"
      title="Mail"
      subtitle="Shared mailboxes with durable search, synchronization, and delivery."
      icon="ti ti-mail"
    >
      <AppOverview.Main
        title="Your mailboxes"
        description={`${props.mailboxes.length} mailbox${props.mailboxes.length === 1 ? "" : "es"} available`}
        toolbar={
          <TextInput
            type="search"
            name="mailbox-search"
            ariaLabel="Search mailboxes"
            placeholder="Search mailboxes..."
            icon="ti ti-search"
            activeIcon="ti ti-search"
            value={query}
            onInput={updateQuery}
            clearable
            onClear={() => updateQuery("")}
          />
        }
      >
        <Show
          when={props.mailboxes.length > 0}
          fallback={
            <AppOverview.EmptyState
              title="No mailboxes yet"
              description="Create a mailbox, then connect its IMAP and SMTP provider."
              icon="ti ti-mail-off"
              class="min-h-72"
            >
              <button type="button" class="btn-secondary btn-sm" onClick={() => createMailbox.mutate()} disabled={createMailbox.loading()}>
                <i class="ti ti-mail-plus" aria-hidden="true" /> Create mailbox
              </button>
            </AppOverview.EmptyState>
          }
        >
          <Show
            when={filtered().length > 0}
            fallback={
              <AppOverview.EmptyState title="No matching mailboxes" description="Try a different search term." icon="ti ti-search">
                <button type="button" class="btn-secondary btn-sm" onClick={() => updateQuery("")}>
                  <i class="ti ti-x" aria-hidden="true" /> Clear search
                </button>
              </AppOverview.EmptyState>
            }
          >
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <For each={filtered()}>
                {(mailbox) => (
                  <a
                    href={`/app/mail/${mailbox.id}`}
                    class="paper group flex items-center gap-3 p-4 no-underline transition-all hover:paper-highlighted"
                    style={`view-transition-name: mail-mailbox-${mailbox.id}`}
                  >
                    <span class="thumbnail flex h-10 w-10 shrink-0 items-center justify-center bg-white shadow-[var(--theme-shadow-elevated)] dark:bg-zinc-950">
                      <i class="ti ti-mail text-lg text-[var(--app-accent)]" aria-hidden="true" />
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-sm font-semibold text-primary">{mailbox.name}</span>
                      <span class="block truncate text-xs text-dimmed">{mailbox.description || mailbox.health.replaceAll("_", " ")}</span>
                    </span>
                    <span class={`badge ${mailbox.health === "active" ? "badge-success" : ""}`}>{mailbox.permission}</span>
                    <i class="ti ti-chevron-right text-dimmed transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </a>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </AppOverview.Main>

      <AppOverview.Aside title="Create" description="Choose the connection model when the mailbox is created.">
        <button
          type="button"
          class="paper flex w-full items-center gap-3 p-4 text-left hover:paper-highlighted"
          onClick={() => createMailbox.mutate()}
          disabled={createMailbox.loading()}
        >
          <span class="thumbnail flex h-9 w-9 items-center justify-center">
            <i class={`ti ${createMailbox.loading() ? "ti-loader-2 animate-spin" : "ti-mail-plus"}`} aria-hidden="true" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-semibold text-primary">New mailbox</span>
            <span class="block text-xs text-dimmed">Private initially; sharing stays explicit.</span>
          </span>
        </button>
      </AppOverview.Aside>
    </AppOverview>
  );
}
