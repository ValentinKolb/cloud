import { listenPopState, navigate, navigateTo } from "@k2b/ssr/nav";
import { mutation as mutations, query as queries, timed } from "@k2b/stdlib/solid";
import { AppOverview, Button, prompts, StatusBadge, TextInput, toast } from "@k2b/ui";
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "../api/client";
import type { DeletedMailbox, DeletedMailboxPage, Mailbox } from "../contracts";
import { readApiError } from "./_components/api-response";
import { openMailboxHealthDialog } from "./_components/MailboxHealthDialog";
import { openMailboxSettingsDialog } from "./_components/MailboxSettingsDialog";
import { mailboxOverviewSubtitle } from "./_components/mail-overview-presentation";
import { assertCursorProgress } from "./pagination";

type MailboxWithPermission = Mailbox & {
  permission: "read" | "write" | "admin";
  receivingAddress: string | null;
};

export default function MailOverview(props: {
  mailboxes: MailboxWithPermission[];
  deletedMailboxes: Array<DeletedMailbox & { permission: "admin" }>;
  initialDeletedCursor: string | null;
  initialQuery: string;
  currentUserEmail: string | null;
}) {
  const [query, setQuery] = createSignal(props.initialQuery);
  const [searchSource, setSearchSource] = createSignal(props.initialQuery.trim());

  const queryHref = (value: string): string => {
    const url = new URL(window.location.href);
    if (value.trim()) url.searchParams.set("q", value.trim());
    else url.searchParams.delete("q");
    return `${url.pathname}${url.search}`;
  };

  const mailboxResults = queries.create<string, { source: string; items: MailboxWithPermission[] }>({
    source: searchSource,
    initial: { source: props.initialQuery.trim(), data: { source: props.initialQuery.trim(), items: props.mailboxes } },
    load: async (value, { abortSignal }) => {
      const response = await apiClient.mailboxes.$get(
        { query: { limit: "200", q: value.trim() || undefined } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Failed to search mailboxes"));
      const items = await response.json();
      return { source: value, items: items.filter((mailbox): mailbox is MailboxWithPermission => mailbox.permission !== "none") };
    },
  });
  const mailboxes = () => {
    const result = mailboxResults.data();
    return result?.source === searchSource() ? result.items : [];
  };
  const mailboxSearchPending = () =>
    mailboxResults.loading() || (mailboxResults.refreshing() && mailboxResults.data()?.source !== searchSource());

  const deletedResults = queries.createInfinite<string, DeletedMailboxPage, string>({
    source: () => "deleted-mailboxes",
    initial: {
      source: "deleted-mailboxes",
      pages: [{ items: props.deletedMailboxes, nextCursor: props.initialDeletedCursor }],
    },
    loadPage: async (_source, { cursor, abortSignal }) => {
      const response = await apiClient.mailboxes.deleted.$get({ query: { limit: "100", cursor } }, { init: { signal: abortSignal } });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to load deleted mailboxes"));
      const page = await response.json();
      assertCursorProgress(cursor, page.nextCursor, "deleted-mailbox");
      return page;
    },
    getNextCursor: (page) => page.nextCursor,
  });
  const deletedMailboxes = createMemo(() => {
    const merged = new Map<string, DeletedMailbox & { permission: "admin" }>();
    for (const page of deletedResults.pages()) for (const mailbox of page.items) merged.set(mailbox.id, mailbox);
    return [...merged.values()];
  });

  const searchDebounce = timed.debounce((value: string) => {
    setSearchSource(value.trim());
    navigate(queryHref(value), { replace: true, scroll: "preserve" });
  }, 200);

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
      void deletedResults.invalidate().catch((error) =>
        prompts.error(error instanceof Error ? error.message : "Deleted mailboxes could not be refreshed", {
          title: "Mailbox restored, refresh failed",
        }),
      );
      toast.success("Mailbox restored in paused state");
      void openMailboxHealthDialog({ mailboxId: mailbox.id }).then(() => navigateTo(`/app/mail/${mailbox.id}`));
    },
    onError: (error) => prompts.error(error.message),
  });

  onCleanup(() => {
    createMailbox.abort();
    restoreMailbox.abort();
  });

  const updateQuery = (value: string) => {
    setQuery(value);
    searchDebounce.debouncedFn(value);
  };
  onMount(() => {
    const stop = listenPopState(({ url }) => {
      searchDebounce.cancel();
      const value = url.searchParams.get("q") ?? "";
      setQuery(value);
      setSearchSource(value.trim());
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
            aria-label="Search mailboxes"
            placeholder="Search mailboxes..."
            icon="ti ti-search"
            activeIcon="ti ti-search"
            value={query}
            onValueChange={updateQuery}
            maxLength={200}
            suffix={
              <Show when={mailboxResults.loading() || mailboxResults.refreshing()}>
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
                mailboxSearchPending()
                  ? "Searching mailboxes"
                  : mailboxResults.error()
                    ? "Could not search mailboxes"
                    : query().trim()
                      ? "No matching mailboxes"
                      : "No mailboxes yet"
              }
              description={
                mailboxSearchPending()
                  ? "The server is loading the matching mailboxes."
                  : mailboxResults.error()
                    ? mailboxResults.error()!.message
                    : query().trim()
                      ? "Try a different search term."
                      : "Create a mailbox, then connect its IMAP and SMTP provider."
              }
              icon={
                mailboxSearchPending()
                  ? "ti ti-loader-2 animate-spin"
                  : mailboxResults.error()
                    ? "ti ti-alert-circle"
                    : query().trim()
                      ? "ti ti-search"
                      : "ti ti-mail-off"
              }
              class="min-h-72"
            >
              <Show
                when={!mailboxSearchPending() && (mailboxResults.error() || query().trim())}
                fallback={
                  <Show when={!mailboxSearchPending()}>
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      onClick={() => createMailbox.mutate()}
                      disabled={createMailbox.loading()}
                    >
                      <i class="ti ti-mail-plus" aria-hidden="true" /> Create mailbox
                    </Button>
                  </Show>
                }
              >
                <Show
                  when={mailboxResults.error()}
                  fallback={
                    <Button variant="secondary" size="sm" type="button" onClick={() => updateQuery("")}>
                      <i class="ti ti-x" aria-hidden="true" /> Clear search
                    </Button>
                  }
                >
                  <Button variant="secondary" size="sm" type="button" onClick={() => void mailboxResults.refresh()}>
                    <i class="ti ti-refresh" aria-hidden="true" /> Retry
                  </Button>
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
                    <span class="block truncate text-xs text-dimmed">{mailboxOverviewSubtitle(mailbox)}</span>
                  </span>
                  <StatusBadge tone="neutral" label={mailbox.permission} icon={null} />
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
          </span>
        </button>
        <Show when={deletedMailboxes().length > 0}>
          <div class="mt-2 flex flex-col gap-2">
            <p class="text-xs font-semibold uppercase text-dimmed">Recently deleted</p>
            <Show when={deletedResults.error()}>{(error) => <p class="text-xs text-danger">{error().message}</p>}</Show>
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
            <Show when={deletedResults.hasMore()}>
              <Button
                variant="secondary"
                size="sm"
                type="button"
                class="self-start"
                disabled={deletedResults.loadingMore()}
                onClick={() => void deletedResults.loadMore()}
              >
                <i class="ti ti-chevron-down" aria-hidden="true" />
                Load more
              </Button>
            </Show>
          </div>
        </Show>
      </AppOverview.Aside>
    </AppOverview>
  );
}
