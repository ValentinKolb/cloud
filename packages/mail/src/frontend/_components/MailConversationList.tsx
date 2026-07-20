import { Placeholder, TextInput, Tooltip } from "@valentinkolb/cloud/ui";
import { Link, type LinkNavigateEvent } from "@valentinkolb/ssr/nav";
import { type DateContext, dates } from "@valentinkolb/stdlib";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { Mailbox } from "../../contracts";
import { MAIL_SEARCH_PARAMETER, parseMailSearchState } from "../../search-state";
import type { SavedConversationView } from "../../service/saved-views";
import { openMailSearchBuilder } from "./MailSearchBuilder";
import { buildMailListHref, buildMailSelectionHref, type MailListItem } from "./mail-navigation";
import { summarizeMailSearchExpression } from "./mail-search-builder-model";

const statusLabel = (item: MailListItem): string | null => {
  if (item.responseNeeded) return "Reply needed";
  if (item.workStatus === "waiting") return "Waiting";
  if (item.workStatus === "done") return "Done";
  if (item.assigneeUserId) return "Assigned";
  return null;
};

export default function MailConversationList(props: {
  mailbox: Mailbox;
  mailboxId: string;
  requestUrl: string;
  query: string;
  title: string;
  items: MailListItem[];
  error: string | null;
  selectedConversationId: string | null;
  selectedMessageId: string | null;
  nextCursor: string | null;
  dateConfig: DateContext;
  canWrite: boolean;
  savedViews: SavedConversationView[];
  activeSavedViewId: string | null;
  loading: boolean;
  onCollapse: () => void;
  onNavigate: (event: LinkNavigateEvent) => void | Promise<void>;
  onNavigateItem: (event: LinkNavigateEvent, item: MailListItem) => void | Promise<void>;
  onOpenHref: (href: string, replace?: boolean) => void | Promise<void>;
  onLoadMore: (href: string) => void | Promise<void>;
}) {
  const requestUrl = () => new URL(props.requestUrl);
  const [searchValue, setSearchValue] = createSignal(props.query);
  const listHref = () => buildMailListHref(requestUrl());
  const parsedSearch = createMemo(() => parseMailSearchState(requestUrl()));
  const activeSavedView = createMemo(() => props.savedViews.find((view) => view.id === props.activeSavedViewId) ?? null);
  const currentSearchState = createMemo(() => parsedSearch().state ?? activeSavedView()?.filter ?? null);
  const structuredSummary = createMemo(() => {
    const state = currentSearchState();
    return state ? summarizeMailSearchExpression(state.expression) : null;
  });
  const searchActive = () => Boolean(props.query.trim() || requestUrl().searchParams.has(MAIL_SEARCH_PARAMETER) || props.activeSavedViewId);

  createEffect(() => setSearchValue(props.query));

  const submitSearch = (event: SubmitEvent) => {
    event.preventDefault();
    const currentUrl = requestUrl();
    const next = new URL(buildMailListHref(currentUrl, true), currentUrl.origin);
    next.searchParams.delete("cursor");
    if (searchValue().trim()) {
      next.searchParams.set("q", searchValue().trim());
      next.searchParams.delete("savedView");
      next.searchParams.delete("view");
      next.searchParams.delete("folder");
      next.searchParams.delete("scheduled");
    }
    void props.onOpenHref(`${next.pathname}${next.search}`);
  };

  const openAdvancedSearch = async () => {
    const result = await openMailSearchBuilder({
      mailboxId: props.mailboxId,
      initialState: currentSearchState(),
      initialQuery: props.query,
      initialSavedView: activeSavedView(),
      canWrite: props.canWrite,
    });
    if (!result) return;
    const currentUrl = requestUrl();
    const next = new URL(buildMailListHref(currentUrl, true), currentUrl.origin);
    if (result.action === "apply") {
      next.searchParams.set(MAIL_SEARCH_PARAMETER, result.serialized);
      next.searchParams.delete("savedView");
      next.searchParams.delete("view");
      next.searchParams.delete("folder");
      next.searchParams.delete("scheduled");
    } else if (result.action === "saved") {
      next.searchParams.set("savedView", result.view.id);
      next.searchParams.delete("view");
      next.searchParams.delete("folder");
      next.searchParams.delete("scheduled");
    } else {
      next.searchParams.delete("savedView");
    }
    next.searchParams.delete("cursor");
    void props.onOpenHref(`${next.pathname}${next.search}`);
  };

  const nextHref = () => {
    if (!props.nextCursor) return null;
    const currentUrl = requestUrl();
    const next = new URL(buildMailListHref(currentUrl), currentUrl.origin);
    next.searchParams.set("cursor", props.nextCursor);
    return `${next.pathname}${next.search}`;
  };

  return (
    <div class="flex h-full min-h-0 flex-col bg-[var(--ui-surface-subtle)]">
      <header class="flex shrink-0 flex-col gap-2 p-3">
        <div class="flex min-w-0 items-center gap-2">
          <div class="min-w-0 flex-1">
            <h1 class="truncate text-base font-semibold text-primary">{props.title}</h1>
            <p class="flex items-center gap-1 text-xs text-dimmed">
              {props.items.length} shown
              <Show when={props.loading}>
                <i class="ti ti-loader-2 animate-spin" aria-hidden="true" />
                <span class="sr-only">Loading view</span>
              </Show>
            </p>
          </div>
          <Tooltip content="Search filters">
            <button
              type="button"
              class={structuredSummary() ? "icon-btn text-[var(--app-accent)]" : "icon-btn"}
              aria-label="Search filters"
              aria-pressed={Boolean(structuredSummary())}
              onClick={openAdvancedSearch}
            >
              <i class="ti ti-adjustments-search" aria-hidden="true" />
            </button>
          </Tooltip>
          <Tooltip content="Hide conversation list">
            <button type="button" class="icon-btn hidden lg:inline-flex" aria-label="Hide conversation list" onClick={props.onCollapse}>
              <i class="ti ti-layout-sidebar-left-collapse" aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
        <form class="flex gap-1" role="search" onSubmit={submitSearch}>
          <TextInput
            type="search"
            name="q"
            ariaLabel={`Search ${props.mailbox.name}`}
            placeholder="Search mailbox"
            icon="ti ti-search"
            activeIcon="ti ti-search"
            value={searchValue}
            onInput={setSearchValue}
            clearable
            onClear={() => setSearchValue("")}
            maxLength={500}
          />
        </form>
        <Show when={structuredSummary()}>
          {(summary) => (
            <button
              type="button"
              class="flex min-w-0 items-center gap-1.5 text-left text-xs text-dimmed hover:text-primary"
              title={summary()}
              onClick={openAdvancedSearch}
            >
              <i class="ti ti-filter-check shrink-0 text-[var(--app-accent)]" aria-hidden="true" />
              <span class="truncate">{summary()}</span>
              <span class="sr-only">Edit structured search</span>
            </button>
          )}
        </Show>
        <Show when={props.mailbox.health !== "active"}>
          <div class="info-block-warning flex items-center gap-2 text-xs" role="status">
            <i class="ti ti-alert-triangle" aria-hidden="true" />
            <span>{props.mailbox.healthReason || `Mailbox is ${props.mailbox.health.replaceAll("_", " ")}.`}</span>
          </div>
        </Show>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2" data-scroll-preserve={`mail-list-${props.mailboxId}`}>
        {props.error ? (
          <Placeholder
            state="error"
            variant="panel"
            title="Could not load conversations"
            description={props.error}
            action={
              <Link href={listHref()} class="btn-secondary btn-sm" onNavigate={props.onNavigate} scroll="preserve">
                Retry
              </Link>
            }
          />
        ) : props.items.length === 0 ? (
          <Placeholder
            icon={searchActive() ? "ti ti-search" : "ti ti-mail-off"}
            variant="panel"
            title={searchActive() ? "No matching messages" : "No conversations here"}
            description={searchActive() ? "Change or clear the active search filters." : "New synchronized mail will appear in this view."}
            action={
              searchActive() ? (
                <Link
                  href={buildMailListHref(requestUrl(), true)}
                  class="btn-secondary btn-sm"
                  onNavigate={props.onNavigate}
                  scroll="preserve"
                >
                  Clear search
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div class="flex flex-col gap-0.5">
            <For each={props.items}>
              {(item) => {
                const selected = item.conversationId
                  ? item.conversationId === props.selectedConversationId
                  : item.id === props.selectedMessageId;
                const state = statusLabel(item);
                return (
                  <Link
                    href={buildMailSelectionHref(requestUrl(), item)}
                    onNavigate={(event) => props.onNavigateItem(event, item)}
                    scroll="preserve"
                    aria-current={selected ? "page" : undefined}
                    class="mail-list-row focus-ui"
                    classList={{ "mail-list-row-unread": item.unread }}
                    title={`${item.participantSummary || "Unknown sender"}: ${item.subject || "(no subject)"}`}
                    draggable={props.canWrite && Boolean(item.conversationId && item.sourceFolderId)}
                    onDragStart={(event) => {
                      const transfer = event.dataTransfer;
                      if (!item.conversationId || !item.sourceFolderId || !transfer) return event.preventDefault();
                      transfer.effectAllowed = "move";
                      transfer.setData(
                        "application/x-cloud-mail-conversation",
                        JSON.stringify({ conversationId: item.conversationId, sourceFolderId: item.sourceFolderId }),
                      );
                    }}
                  >
                    <span
                      class={`h-2 w-2 rounded-full ${item.unread ? "bg-[var(--app-accent)]" : "ring-1 ring-[var(--ui-border-strong)]"}`}
                      aria-hidden="true"
                    />
                    <span class="truncate text-sm text-primary">{item.participantSummary || "Unknown sender"}</span>
                    <span class="min-w-0 truncate text-xs text-dimmed">
                      <Show when={item.primaryReference}>
                        <span class="mr-1 font-mono text-[0.6875rem] text-dimmed">{item.primaryReference}</span>
                      </Show>
                      <span class="font-medium text-primary">{item.subject || "(no subject)"}</span>
                      <Show when={item.preview}>
                        <span aria-hidden="true"> · </span>
                        <span>{item.preview}</span>
                      </Show>
                    </span>
                    <span class="flex min-w-0 items-center justify-end gap-1.5 text-xs text-dimmed">
                      <Show when={state}>
                        <span class="hidden max-w-20 truncate xl:inline">{state}</span>
                      </Show>
                      <Show when={item.hasAttachments}>
                        <i class="ti ti-paperclip shrink-0" aria-hidden="true" />
                        <span class="sr-only">Has attachments</span>
                      </Show>
                      <time
                        class="shrink-0 tabular-nums"
                        dateTime={item.latestMessageAt}
                        title={dates.formatDateTime(item.latestMessageAt, props.dateConfig)}
                      >
                        {dates.formatDateTimeRelative(item.latestMessageAt, props.dateConfig)}
                      </time>
                    </span>
                  </Link>
                );
              }}
            </For>
          </div>
        )}
        <Show when={nextHref()}>
          <div class="flex justify-center py-3">
            <button type="button" class="btn-secondary btn-sm" disabled={props.loading} onClick={() => void props.onLoadMore(nextHref()!)}>
              <i class="ti ti-chevron-down" aria-hidden="true" /> More conversations
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
}
