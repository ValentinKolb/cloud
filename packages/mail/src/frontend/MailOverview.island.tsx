import { listenPopState, navigate, navigateTo } from "@k2b/ssr/nav";
import { dates, type DateContext } from "@k2b/stdlib";
import { mutation as mutations, query as queries } from "@k2b/stdlib/solid";
import { AppOverview, Button, prompts, Tabs, toast } from "@k2b/ui";
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "../api/client";
import type { DeletedMailbox, DeletedMailboxPage, Mailbox, MailFocusPage, MailFocusView } from "../contracts";
import { readApiError } from "./_components/api-response";
import { openMailboxHealthDialog } from "./_components/MailboxHealthDialog";
import { openMailboxSettingsDialog } from "./_components/MailboxSettingsDialog";
import { mailboxOverviewSubtitle } from "./_components/mail-overview-presentation";
import { assertCursorProgress } from "./pagination";

type MailboxWithPermission = Mailbox & { permission: "read" | "write" | "admin"; receivingAddress: string | null };

const viewLabels: Record<MailFocusView, string> = {
  mine: "For me",
  unassigned: "Unassigned",
  waiting: "Waiting",
  all: "All active",
};

const viewDescriptions: Record<MailFocusView, (count: number) => string> = {
  mine: (count) => `${count} conversation${count === 1 ? "" : "s"} assigned to you`,
  unassigned: (count) => `${count} conversation${count === 1 ? "" : "s"} without an assignee`,
  waiting: (count) => `${count} conversation${count === 1 ? "" : "s"} waiting for a reply`,
  all: (count) => `${count} active conversation${count === 1 ? "" : "s"}`,
};

const viewEyebrows: Record<MailFocusView, string> = {
  mine: "Assigned to you",
  unassigned: "Unassigned",
  waiting: "Waiting for reply",
  all: "All active",
};

const primaryParticipant = (summary: string): string => summary.split(/\s[·,]\s/u)[0]?.trim() || "Unknown sender";
const participantInitials = (summary: string): string => {
  const words = primaryParticipant(summary)
    .split(/\s+/u)
    .filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toLocaleUpperCase())
    .join("") || "M";
};
const avatarTone = (summary: string): string =>
  String([...primaryParticipant(summary)].reduce((total, character) => total + character.codePointAt(0)!, 0) % 5);

export default function MailOverview(props: {
  mailboxes: MailboxWithPermission[];
  deletedMailboxes: Array<DeletedMailbox & { permission: "admin" }>;
  initialDeletedCursor: string | null;
  initialFocus: MailFocusPage;
  initialView: MailFocusView;
  currentUserEmail: string | null;
  dateConfig: DateContext;
}) {
  const [view, setView] = createSignal<MailFocusView>(props.initialView);
  const focusResults = queries.createInfinite<MailFocusView, MailFocusPage, string>({
    source: view,
    initial: { source: props.initialView, pages: [props.initialFocus] },
    loadPage: async (source, { cursor, abortSignal }) => {
      const response = await apiClient.overview.conversations.$get(
        { query: { view: source, limit: "50", cursor } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Failed to load focused mail"));
      const page = await response.json();
      assertCursorProgress(cursor, page.nextCursor, "mail-focus");
      return page;
    },
    getNextCursor: (page) => page.nextCursor,
  });
  const focusItems = createMemo(() => focusResults.pages().flatMap((page) => page.items));
  const counts = () => focusResults.pages()[0]?.counts ?? props.initialFocus.counts;
  const focusDescription = () => viewDescriptions[view()](counts()[view()]);

  const selectView = (next: MailFocusView) => {
    setView(next);
    const url = new URL(window.location.href);
    if (next === "mine") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    navigate(`${url.pathname}${url.search}`, { scroll: "preserve" });
  };

  const deletedResults = queries.createInfinite<string, DeletedMailboxPage, string>({
    source: () => "deleted-mailboxes",
    initial: { source: "deleted-mailboxes", pages: [{ items: props.deletedMailboxes, nextCursor: props.initialDeletedCursor }] },
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

  const createMailbox = mutations.create<Mailbox | null, void>({
    mutation: async (_input, { abortSignal }) => {
      const values = await prompts.form({
        title: "New mailbox",
        icon: "ti ti-mail-plus",
        fields: {
          name: { type: "text", label: "Name", description: "The label everyone with access sees.", required: true },
          description: { type: "text", label: "Description", description: "Optional context for collaborators.", multiline: true, lines: 3 },
        },
        confirmText: "Create mailbox",
      });
      if (!values || abortSignal.aborted) return null;
      const response = await apiClient.mailboxes.$post(
        { json: { name: values.name, description: values.description || null } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Failed to create mailbox"));
      return response.json();
    },
    onSuccess: (mailbox) => {
      if (!mailbox) return;
      toast.success("Mailbox created");
      void openMailboxSettingsDialog({ mailboxId: mailbox.id, currentUserEmail: props.currentUserEmail, initialTab: "delivery" }).then(
        (result) => navigateTo(result.deleted ? "/app/mail" : `/app/mail/${mailbox.id}`),
      );
    },
    onError: (error) => prompts.error(error.message),
  });

  const restoreMailbox = mutations.create<Mailbox | null, string>({
    mutation: async (mailboxId, { abortSignal }) => {
      const confirmed = await prompts.confirm(
        "The mailbox will return in paused state. Verify its provider before resuming synchronization.",
        { title: "Restore mailbox", confirmText: "Restore mailbox" },
      );
      if (!confirmed || abortSignal.aborted) return null;
      const response = await apiClient.mailboxes[":mailboxId"].restore.$post({ param: { mailboxId } }, { init: { signal: abortSignal } });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to restore mailbox"));
      return response.json();
    },
    onSuccess: (mailbox) => {
      if (!mailbox) return;
      void deletedResults.invalidate();
      toast.success("Mailbox restored in paused state");
      void openMailboxHealthDialog({ mailboxId: mailbox.id }).then(() => navigateTo(`/app/mail/${mailbox.id}`));
    },
    onError: (error) => prompts.error(error.message),
  });

  onMount(() => {
    const stop = listenPopState(({ url }) => {
      const parsed = url.searchParams.get("view");
      setView(parsed === "unassigned" || parsed === "waiting" || parsed === "all" ? parsed : "mine");
    });
    onCleanup(stop);
  });
  onCleanup(() => {
    createMailbox.abort();
    restoreMailbox.abort();
  });

  const focusPanel = () => (
    <>
      <div class="mail-focus-list-heading">
        <span>{viewEyebrows[view()]}</span>
        <span>Newest first</span>
      </div>
      <Show when={focusResults.error()}>
        {(error) => (
          <AppOverview.EmptyState title="Could not load focused mail" description={error().message} icon="ti ti-alert-circle" class="min-h-56">
            <Button variant="secondary" size="sm" onClick={() => void focusResults.refresh()}>
              <i class="ti ti-refresh" aria-hidden="true" /> Retry
            </Button>
          </AppOverview.EmptyState>
        )}
      </Show>
      <Show when={!focusResults.error() && focusItems().length === 0}>
        <AppOverview.EmptyState
          title={focusResults.loading() ? "Loading focused mail" : `Nothing ${viewLabels[view()].toLowerCase()}`}
          description={focusResults.loading() ? "The server is collecting conversations across your mailboxes." : "There are no matching active conversations."}
          icon={focusResults.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-circle-check"}
          class="min-h-56"
        />
      </Show>
      <Show when={!focusResults.error() && focusItems().length > 0}>
        <div class="mail-focus-list" aria-live="polite">
          <For each={focusItems()}>
            {(item) => (
              <a href={`/app/mail/${item.mailboxId}?conversation=${item.id}`} class="mail-focus-row group">
                <span class="mail-focus-unread-slot" aria-hidden="true">
                  <Show when={item.unread}><span class="mail-focus-unread-dot" /></Show>
                </span>
                <span class="mail-focus-avatar" data-tone={avatarTone(item.participantSummary)} aria-hidden="true">
                  {participantInitials(item.participantSummary)}
                </span>
                <span class="mail-focus-copy">
                  <span class="mail-focus-sender">{primaryParticipant(item.participantSummary)}</span>
                  <span class={`mail-focus-subject ${item.unread ? "mail-focus-subject-unread" : ""}`}>{item.subject || "(No subject)"}</span>
                  <span class="mail-focus-preview">{item.preview || "No preview available"}</span>
                  <span class="mail-focus-meta">
                    <span><i class="ti ti-inbox" aria-hidden="true" /> {item.mailboxName}</span>
                    <span class={item.workStatus === "waiting" ? "mail-focus-status-waiting" : "mail-focus-status-action"}>
                      <i class={item.workStatus === "waiting" ? "ti ti-clock" : "ti ti-message-exclamation"} aria-hidden="true" />
                      {item.workStatus === "waiting" ? "Waiting" : "Needs action"}
                    </span>
                    <Show when={item.flagged}><span><i class="ti ti-flag-filled" aria-hidden="true" /> Flagged</span></Show>
                    <Show when={item.hasAttachments}><span><i class="ti ti-paperclip" aria-hidden="true" /> Attachment</span></Show>
                  </span>
                </span>
                <time class="mail-focus-time" dateTime={item.latestMessageAt} title={dates.formatDateTime(item.latestMessageAt, props.dateConfig)}>
                  {dates.formatDateTimeRelative(item.latestMessageAt, props.dateConfig)}
                </time>
                <i class="ti ti-chevron-right mail-focus-chevron" aria-hidden="true" />
              </a>
            )}
          </For>
          <Show when={focusResults.hasMore()}>
            <Button variant="secondary" size="sm" class="self-center" disabled={focusResults.loadingMore()} onClick={() => void focusResults.loadMore()}>
              <i class={focusResults.loadingMore() ? "ti ti-loader-2 animate-spin" : "ti ti-chevron-down"} aria-hidden="true" /> Load more
            </Button>
          </Show>
        </div>
      </Show>
    </>
  );

  return (
    <AppOverview title="Mail" subtitle="What needs attention across your mailboxes." icon="ti ti-mail">
      <AppOverview.Main title="Focus" description={focusDescription()} class="mail-focus-panel">
        <Tabs<MailFocusView> ariaLabel="Mail focus view" value={view} onValueChange={selectView} class="mail-focus-tabs">
          <Tabs.Item value="mine" label={<>For me <span class="mail-focus-tab-count">{counts().mine}</span></>}>
            {focusPanel()}
          </Tabs.Item>
          <Tabs.Item value="unassigned" label={<>Unassigned <span class="mail-focus-tab-count">{counts().unassigned}</span></>}>
            {focusPanel()}
          </Tabs.Item>
          <Tabs.Item value="waiting" label={<>Waiting <span class="mail-focus-tab-count">{counts().waiting}</span></>}>
            {focusPanel()}
          </Tabs.Item>
          <Tabs.Item value="all" label={<>All active <span class="mail-focus-tab-count">{counts().all}</span></>}>
            {focusPanel()}
          </Tabs.Item>
        </Tabs>
      </AppOverview.Main>

      <AppOverview.Aside title="Mailboxes" description="Open a mailbox for folders, search, and settings.">
        <button
          type="button"
          class="paper flex w-full items-center gap-3 p-3 text-left hover:paper-highlighted"
          onClick={() => createMailbox.mutate()}
          disabled={createMailbox.loading()}
        >
          <i class={`ti ${createMailbox.loading() ? "ti-loader-2 animate-spin" : "ti-mail-plus"}`} aria-hidden="true" />
          <span class="text-sm font-semibold text-primary">New mailbox</span>
        </button>
        <div class="mt-2 flex flex-col gap-2">
          <For each={props.mailboxes}>
            {(mailbox) => (
              <a href={`/app/mail/${mailbox.id}`} class="paper flex items-center gap-3 p-3 no-underline hover:paper-highlighted">
                <i class="ti ti-mail text-[var(--app-accent)]" aria-hidden="true" />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-semibold text-primary">{mailbox.name}</span>
                  <span class="block truncate text-xs text-dimmed">{mailboxOverviewSubtitle(mailbox)}</span>
                </span>
                <i class="ti ti-chevron-right text-dimmed" aria-hidden="true" />
              </a>
            )}
          </For>
        </div>
        <Show when={deletedMailboxes().length > 0}>
          <div class="mt-4 flex flex-col gap-2">
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
          </div>
        </Show>
      </AppOverview.Aside>
    </AppOverview>
  );
}
