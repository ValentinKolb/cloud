import { AppOverview, prompts, TextInput, toast } from "@valentinkolb/cloud/ui";
import { listenPopState, navigate, navigateTo } from "@k2b/ssr/nav";
import { mutation as mutations } from "@k2b/stdlib/solid";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "../api/client";
import type { DeletedMailbox, DeletedMailboxPage, Mailbox } from "../contracts";
import { readApiError } from "./_components/api-response";
import { openMailboxHealthDialog } from "./_components/MailboxHealthDialog";
import { openMailboxSettingsDialog } from "./_components/MailboxSettingsDialog";

type MailboxWithPermission = Mailbox & { permission: "read" | "write" | "admin" };

export default function MailOverview(props: {
  mailboxes: MailboxWithPermission[];
  deletedMailboxes: Array<DeletedMailbox & { permission: "admin" }>;
  initialDeletedCursor: string | null;
  initialQuery: string;
  currentUserEmail: string | null;
}) {
  const [query, setQuery] = createSignal(props.initialQuery);
  const [mailboxes, setMailboxes] = createSignal(props.mailboxes);
  const [searchLoading, setSearchLoading] = createSignal(false);
  const [searchError, setSearchError] = createSignal<string | null>(null);
  const [deletedMailboxes, setDeletedMailboxes] = createSignal(props.deletedMailboxes);
  const [deletedCursor, setDeletedCursor] = createSignal(props.initialDeletedCursor);
  let queryTimer: ReturnType<typeof setTimeout> | null = null;
  let searchController: AbortController | null = null;
  let searchGeneration = 0;

  const queryHref = (value: string): string => {
    const url = new URL(window.location.href);
    if (value.trim()) url.searchParams.set("q", value.trim());
    else url.searchParams.delete("q");
    return `${url.pathname}${url.search}`;
  };

  const loadQuery = async (value: string, history: "replace" | "none") => {
    setQuery(value);
    if (history === "replace") navigate(queryHref(value), { replace: true, scroll: "preserve" });
    searchController?.abort();
    const controller = new AbortController();
    const generation = ++searchGeneration;
    searchController = controller;
    setSearchLoading(true);
    setSearchError(null);
    setMailboxes([]);
    try {
      const response = await apiClient.mailboxes.$get(
        { query: { limit: "200", q: value.trim() || undefined } },
        { init: { signal: controller.signal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Failed to search mailboxes"));
      const items = await response.json();
      if (generation !== searchGeneration) return;
      setMailboxes(items.filter((mailbox): mailbox is MailboxWithPermission => mailbox.permission !== "none"));
    } catch (error) {
      if (generation !== searchGeneration || controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : "Failed to search mailboxes";
      setSearchError(message);
      toast.error(message);
    } finally {
      if (generation === searchGeneration) {
        searchController = null;
        setSearchLoading(false);
      }
    }
  };

  const createMailbox = mutations.create<Mailbox | null, void>({
    mutation: async (_input, { abortSignal }) => {
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
        },
        confirmText: "Create mailbox",
      });
      if (!values || abortSignal.aborted) return null;
      const response = await apiClient.mailboxes.$post(
        {
          json: { name: values.name, description: values.description || null },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Failed to create mailbox"));
      return await response.json();
    },
    onSuccess: (mailbox) => {
      if (!mailbox) return;
      toast.success("Mailbox created");
      void openMailboxSettingsDialog({
        mailboxId: mailbox.id,
        currentUserEmail: props.currentUserEmail,
        initialTab: "delivery",
      }).then((result) => navigateTo(result.deleted ? "/app/mail" : `/app/mail/${mailbox.id}`));
    },
    onError: (error) => prompts.error(error.message),
  });

  const restoreMailbox = mutations.create<Mailbox | null, string>({
    mutation: async (mailboxId, { abortSignal }) => {
      const confirmed = await prompts.confirm(
        "The mailbox will return in paused state. Verify its provider before resuming synchronization.",
        {
          title: "Restore mailbox",
          confirmText: "Restore mailbox",
        },
      );
      if (!confirmed || abortSignal.aborted) return null;
      const response = await apiClient.mailboxes[":mailboxId"].restore.$post({ param: { mailboxId } }, { init: { signal: abortSignal } });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to restore mailbox"));
      return response.json();
    },
    onSuccess: (mailbox) => {
      if (!mailbox) return;
      setDeletedMailboxes((current) => current.filter((entry) => entry.id !== mailbox.id));
      toast.success("Mailbox restored in paused state");
      void openMailboxHealthDialog({ mailboxId: mailbox.id }).then(() => navigateTo(`/app/mail/${mailbox.id}`));
    },
    onError: (error) => prompts.error(error.message),
  });

  const loadDeletedMailboxes = mutations.create<DeletedMailboxPage, string>({
    mutation: async (cursor, { abortSignal }) => {
      const response = await apiClient.mailboxes.deleted.$get({ query: { limit: "100", cursor } }, { init: { signal: abortSignal } });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to load deleted mailboxes"));
      return response.json();
    },
    onSuccess: (page) => {
      setDeletedMailboxes((current) => {
        const existing = new Set(current.map((mailbox) => mailbox.id));
        return [...current, ...page.items.filter((mailbox) => !existing.has(mailbox.id))];
      });
      setDeletedCursor(page.nextCursor);
    },
    onError: (error) => prompts.error(error.message),
  });
  onCleanup(() => {
    if (queryTimer) clearTimeout(queryTimer);
    searchGeneration += 1;
    searchController?.abort();
    searchController = null;
    createMailbox.abort();
    restoreMailbox.abort();
    loadDeletedMailboxes.abort();
  });

  const updateQuery = (value: string) => {
    setQuery(value);
    searchGeneration += 1;
    searchController?.abort();
    searchController = null;
    setSearchLoading(false);
    setSearchError(null);
    if (queryTimer) clearTimeout(queryTimer);
    queryTimer = setTimeout(() => {
      queryTimer = null;
      void loadQuery(value, "replace");
    }, 200);
  };
  onMount(() => {
    const stop = listenPopState(({ url }) => {
      if (queryTimer) clearTimeout(queryTimer);
      queryTimer = null;
      void loadQuery(url.searchParams.get("q") ?? "", "none");
    });
    onCleanup(stop);
  });

  return (
    <AppOverview title="Mail" subtitle="Shared mailboxes with durable search, synchronization, and delivery." icon="ti ti-mail">
      <AppOverview.Main
        title="Your mailboxes"
        description={`${mailboxes().length} mailbox${mailboxes().length === 1 ? "" : "es"} available`}
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
            maxLength={200}
            suffix={
              <Show when={searchLoading()}>
                <i class="ti ti-loader-2 animate-spin text-dimmed" aria-hidden="true" />
              </Show>
            }
            clearable
            onClear={() => updateQuery("")}
          />
        }
      >
        <Show
          when={mailboxes().length > 0}
          fallback={
            <AppOverview.EmptyState
              title={
                searchLoading()
                  ? "Searching mailboxes"
                  : searchError()
                    ? "Could not search mailboxes"
                    : query().trim()
                      ? "No matching mailboxes"
                      : "No mailboxes yet"
              }
              description={
                searchLoading()
                  ? "The server is loading the matching mailboxes."
                  : searchError()
                    ? searchError()!
                    : query().trim()
                      ? "Try a different search term."
                      : "Create a mailbox, then connect its IMAP and SMTP provider."
              }
              icon={
                searchLoading()
                  ? "ti ti-loader-2 animate-spin"
                  : searchError()
                    ? "ti ti-alert-circle"
                    : query().trim()
                      ? "ti ti-search"
                      : "ti ti-mail-off"
              }
              class="min-h-72"
            >
              <Show
                when={!searchLoading() && (searchError() || query().trim())}
                fallback={
                  <Show when={!searchLoading()}>
                    <button
                      type="button"
                      class="btn-secondary btn-sm"
                      onClick={() => createMailbox.mutate()}
                      disabled={createMailbox.loading()}
                    >
                      <i class="ti ti-mail-plus" aria-hidden="true" /> Create mailbox
                    </button>
                  </Show>
                }
              >
                <Show
                  when={searchError()}
                  fallback={
                    <button type="button" class="btn-secondary btn-sm" onClick={() => updateQuery("")}>
                      <i class="ti ti-x" aria-hidden="true" /> Clear search
                    </button>
                  }
                >
                  <button type="button" class="btn-secondary btn-sm" onClick={() => void loadQuery(query(), "none")}>
                    <i class="ti ti-refresh" aria-hidden="true" /> Retry
                  </button>
                </Show>
              </Show>
            </AppOverview.EmptyState>
          }
        >
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <For each={mailboxes()}>
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
      </AppOverview.Main>

      <AppOverview.Aside title="Create" description="Create a private mailbox, then connect its provider.">
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
        <Show when={deletedMailboxes().length > 0}>
          <div class="mt-2 flex flex-col gap-2">
            <p class="text-xs font-semibold uppercase text-dimmed">Recently deleted</p>
            <For each={deletedMailboxes()}>
              {(mailbox) => (
                <button
                  type="button"
                  class="paper flex w-full items-center gap-3 p-3 text-left hover:paper-highlighted"
                  disabled={restoreMailbox.loading()}
                  onClick={() => restoreMailbox.mutate(mailbox.id)}
                >
                  <i class="ti ti-restore text-dimmed" aria-hidden="true" />
                  <span class="min-w-0 flex-1 truncate text-sm font-medium text-primary">{mailbox.name}</span>
                  <span class="text-xs text-dimmed">Restore</span>
                </button>
              )}
            </For>
            <Show when={deletedCursor()}>
              {(cursor) => (
                <button
                  type="button"
                  class="btn-secondary btn-sm self-start"
                  disabled={loadDeletedMailboxes.loading()}
                  onClick={() => loadDeletedMailboxes.mutate(cursor())}
                >
                  <i class="ti ti-chevron-down" aria-hidden="true" />
                  Load more
                </button>
              )}
            </Show>
          </div>
        </Show>
      </AppOverview.Aside>
    </AppOverview>
  );
}
