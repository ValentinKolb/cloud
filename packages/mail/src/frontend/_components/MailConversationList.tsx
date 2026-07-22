import { Dropdown, MultiSelectInput, Placeholder, TextInput, Tooltip } from "@valentinkolb/cloud/ui";
import { Link, type LinkNavigateEvent } from "@valentinkolb/ssr/nav";
import { type DateContext, dates } from "@valentinkolb/stdlib";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { Mailbox } from "../../contracts";
import {
  MAIL_QUICK_SEARCH_FIELDS,
  MAIL_QUICK_SEARCH_FIELDS_PARAMETER,
  MAIL_SEARCH_PARAMETER,
  type MailQuickSearchField,
  parseMailQuickSearchFields,
  parseMailSearchState,
  resolveMailSearchRoute,
} from "../../search-state";
import type { SavedConversationView } from "../../service/saved-views";
import MailBulkActionBar from "./MailBulkActionBar";
import { openMailSearchBuilder } from "./MailSearchBuilder";
import { getMailAction, type MailActionId } from "./mail-actions";
import { MAX_MAIL_CONVERSATION_SELECTION } from "./mail-conversation-selection";
import { mailboxHealthMessage } from "./mail-health-presentation";
import { buildMailListHref, buildMailSelectionHref, isMailListItemActive, type MailListItem } from "./mail-navigation";
import { summarizeMailSearchExpression } from "./mail-search-builder-model";

const statusLabel = (item: MailListItem): string | null => {
  if (item.responseNeeded) return "Reply needed";
  if (item.workStatus === "waiting") return "Awaiting reply";
  if (item.workStatus === "done") return "Done";
  if (item.assigneeUserId) return "Assigned";
  return null;
};

const statusIcon = (item: MailListItem): string | null => {
  if (item.responseNeeded) return "ti ti-message-reply";
  if (item.workStatus === "waiting") return "ti ti-hourglass";
  if (item.workStatus === "done") return "ti ti-checkbox";
  if (item.assigneeUserId) return "ti ti-user-check";
  return null;
};

const correspondentLabels = (item: MailListItem): string[] =>
  item.participantLabels.length > 0 ? item.participantLabels : [item.participantSummary || "Unknown sender"];

const QUICK_SEARCH_FIELD_OPTIONS = [
  { id: "from", label: "Sender", icon: "ti ti-user" },
  { id: "subject", label: "Subject", icon: "ti ti-letter-case" },
  { id: "body", label: "Body", icon: "ti ti-align-left" },
] satisfies Array<{ id: MailQuickSearchField; label: string; icon: string }>;

const selectedQuickSearchFields = (url: URL): MailQuickSearchField[] => {
  const fields = parseMailQuickSearchFields(url);
  return fields.length > 0 ? fields : [...MAIL_QUICK_SEARCH_FIELDS];
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
  selectedConversationIds: ReadonlySet<string>;
  selectionMode: boolean;
  nextCursor: string | null;
  dateConfig: DateContext;
  canWrite: boolean;
  savedViews: SavedConversationView[];
  activeSavedViewId: string | null;
  loading: boolean;
  liveDegraded: boolean;
  onCollapse: () => void;
  onNavigate: (event: LinkNavigateEvent) => void | Promise<void>;
  onNavigateItem: (href: string, item: MailListItem, activation: "keyboard" | "pointer") => void | Promise<void>;
  onToggleSelectionMode: () => void;
  onToggleSelection: (item: MailListItem, range: boolean) => void;
  onClearSelection: () => void;
  onAddTags: () => void | Promise<void>;
  onBulkAction: (actionId: MailActionId) => void | Promise<void>;
  onItemAction: (item: MailListItem, actionId: MailActionId) => void | Promise<void>;
  onManageTags: (item: MailListItem) => void | Promise<void>;
  onMergeItem: (item: MailListItem) => void | Promise<void>;
  onPrefetch: (item: MailListItem) => void;
  onOpenHref: (href: string, replace?: boolean) => void | Promise<void>;
  onLoadMore: (href: string) => boolean | Promise<boolean>;
}) {
  const requestUrl = () => new URL(props.requestUrl);
  const [searchValue, setSearchValue] = createSignal(props.query);
  const [searchFields, setSearchFields] = createSignal<MailQuickSearchField[]>(selectedQuickSearchFields(requestUrl()));
  const [loadMoreElement, setLoadMoreElement] = createSignal<HTMLDivElement>();
  const [failedLoadHref, setFailedLoadHref] = createSignal<string | null>(null);
  let listScrollElement: HTMLDivElement | undefined;
  let requestedLoadHref: string | null = null;
  const listHref = () => buildMailListHref(requestUrl());
  const parsedSearch = createMemo(() => parseMailSearchState(requestUrl()));
  const activeSavedView = createMemo(() => props.savedViews.find((view) => view.id === props.activeSavedViewId) ?? null);
  const currentSearchState = createMemo(() => {
    const parsed = parsedSearch().state;
    if (parsed) return parsed;
    const saved = activeSavedView()?.filter;
    if (saved) return saved;
    const resolved = resolveMailSearchRoute(requestUrl());
    return resolved.expression ? { expression: resolved.expression, sort: resolved.sort } : null;
  });
  const structuredSummary = createMemo(() => {
    const state = currentSearchState();
    return state ? summarizeMailSearchExpression(state.expression) : null;
  });
  const searchActive = () => Boolean(props.query.trim() || requestUrl().searchParams.has(MAIL_SEARCH_PARAMETER) || props.activeSavedViewId);
  createEffect(() => {
    setSearchValue(props.query);
    setSearchFields(selectedQuickSearchFields(requestUrl()));
  });

  const applyQuickSearch = (query: string, fields: MailQuickSearchField[]) => {
    const currentUrl = requestUrl();
    const next = new URL(buildMailListHref(currentUrl, true), currentUrl.origin);
    const normalizedQuery = query.trim();
    if (normalizedQuery) {
      next.searchParams.set("q", normalizedQuery);
      next.searchParams.set(MAIL_QUICK_SEARCH_FIELDS_PARAMETER, fields.join(","));
      next.searchParams.delete("savedView");
      next.searchParams.delete("view");
      next.searchParams.delete("folder");
      next.searchParams.delete("scheduled");
    }
    void props.onOpenHref(`${next.pathname}${next.search}`);
  };

  const submitSearch = (event: SubmitEvent) => {
    event.preventDefault();
    applyQuickSearch(searchValue(), searchFields());
  };

  const updateSearchFields = (next: string[]) => {
    const valid = next.filter((field): field is MailQuickSearchField => QUICK_SEARCH_FIELD_OPTIONS.some((option) => option.id === field));
    const normalized = valid.length > 0 ? valid : [...MAIL_QUICK_SEARCH_FIELDS];
    setSearchFields(normalized);
    if (searchValue().trim()) applyQuickSearch(searchValue(), normalized);
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

  const loadNextPage = async (href: string) => {
    if (props.loading || requestedLoadHref === href) return;
    requestedLoadHref = href;
    setFailedLoadHref(null);
    const loaded = await props.onLoadMore(href);
    if (!loaded && nextHref() === href) setFailedLoadHref(href);
    if (nextHref() !== href) requestedLoadHref = null;
  };

  createEffect(() => {
    const element = loadMoreElement();
    const href = nextHref();
    if (!element || !href || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadNextPage(href);
      },
      { root: listScrollElement ?? null, rootMargin: "480px 0px" },
    );
    observer.observe(element);
    onCleanup(() => observer.disconnect());
  });

  return (
    <div class="flex h-full min-h-0 flex-col bg-[var(--ui-surface-subtle)]">
      <header class="flex shrink-0 flex-col gap-2 p-3">
        <Show
          when={props.canWrite && props.selectionMode}
          fallback={
            <div class="flex min-w-0 items-center gap-2">
              <div class="min-w-0 flex-1">
                <h1 class="truncate text-base font-semibold text-primary">{props.title}</h1>
                <p class="flex items-center gap-1 text-xs text-dimmed">
                  {props.items.length} shown
                  <Show when={props.loading}>
                    <i class="ti ti-loader-2 animate-spin" aria-hidden="true" />
                    <span class="sr-only">Loading view</span>
                  </Show>
                  <Show when={props.liveDegraded}>
                    <i class="ti ti-cloud-off" aria-hidden="true" />
                    <span>Reconnecting</span>
                  </Show>
                </p>
              </div>
              <Show when={props.canWrite}>
                <Tooltip content="Select conversations">
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label="Select conversations"
                    aria-pressed="false"
                    onClick={props.onToggleSelectionMode}
                  >
                    <i class="ti ti-checkbox" aria-hidden="true" />
                  </button>
                </Tooltip>
              </Show>
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
          }
        >
          <MailBulkActionBar
            selectedCount={props.selectedConversationIds.size}
            busy={props.loading}
            onClear={props.onClearSelection}
            onAddTags={props.onAddTags}
            onAction={props.onBulkAction}
          />
        </Show>
        <form class="flex min-w-0 items-center gap-2" role="search" onSubmit={submitSearch}>
          <div class="min-w-0 flex-1">
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
              onClear={() => {
                setSearchValue("");
                applyQuickSearch("", searchFields());
              }}
              maxLength={500}
            />
          </div>
          <div class="w-40 shrink-0">
            <MultiSelectInput
              icon="ti ti-filter-search"
              placeholder="Search in"
              value={searchFields}
              onChange={updateSearchFields}
              options={QUICK_SEARCH_FIELD_OPTIONS}
            />
          </div>
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
            <span>{mailboxHealthMessage(props.mailbox.health)}</span>
          </div>
        </Show>
      </header>

      <div
        ref={(element) => {
          listScrollElement = element;
        }}
        class="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
        data-scroll-preserve={`mail-list-${props.mailboxId}`}
      >
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
          <div class="flex flex-col gap-0.5" role="list" aria-label={`${props.title} conversations`}>
            <For each={props.items}>
              {(item) => {
                const selected = () => isMailListItemActive(item, props.selectedConversationId, props.selectedMessageId);
                const state = statusLabel(item);
                const stateIcon = statusIcon(item);
                const correspondents = correspondentLabels(item);
                const primaryCorrespondent = correspondents[0] ?? "Unknown sender";
                const additionalCorrespondents = Math.max(0, correspondents.length - 1);
                const tagLabel = item.localTags.map((tag) => tag.name).join(", ");
                let activation: "keyboard" | "pointer" = "keyboard";
                let selectRange = false;
                const bulkSelected = () => Boolean(item.conversationId && props.selectedConversationIds.has(item.conversationId));
                return (
                  <div
                    class="mail-list-entry group relative"
                    classList={{
                      "mail-list-entry-active": selected(),
                      "mail-list-entry-selected": bulkSelected(),
                      "mail-list-entry-selection-mode": props.selectionMode,
                    }}
                    role="listitem"
                    data-conversation-id={item.conversationId ?? undefined}
                  >
                    <Show when={props.canWrite && props.selectionMode && item.conversationId}>
                      <input
                        type="checkbox"
                        class="mail-list-checkbox h-4 w-4"
                        checked={bulkSelected()}
                        disabled={!bulkSelected() && props.selectedConversationIds.size >= MAX_MAIL_CONVERSATION_SELECTION}
                        aria-label={`${bulkSelected() ? "Deselect" : "Select"} ${item.subject || "conversation"}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          selectRange = event.shiftKey;
                        }}
                        onChange={() => {
                          props.onToggleSelection(item, selectRange);
                          selectRange = false;
                        }}
                      />
                    </Show>
                    <a
                      href={buildMailSelectionHref(requestUrl(), item)}
                      aria-current={selected() ? "page" : undefined}
                      class="mail-list-row focus-ui"
                      title={`${correspondents.join(", ")}: ${item.subject || "(no subject)"}`}
                      draggable={props.canWrite && Boolean(item.conversationId && item.sourceFolderId)}
                      onClick={(event) => {
                        activation = event.detail === 0 ? "keyboard" : "pointer";
                        if (event.defaultPrevented || event.button !== 0 || event.altKey) return;
                        if (!props.canWrite && (event.shiftKey || event.metaKey || event.ctrlKey)) return;
                        const select = Boolean(
                          item.conversationId &&
                            props.canWrite &&
                            (props.selectionMode || event.shiftKey || event.metaKey || event.ctrlKey),
                        );
                        event.preventDefault();
                        if (select) props.onToggleSelection(item, event.shiftKey);
                        else void props.onNavigateItem(event.currentTarget.href, item, activation);
                      }}
                      onFocus={() => props.onPrefetch(item)}
                      onPointerEnter={() => props.onPrefetch(item)}
                      onDragStart={(event) => {
                        const transfer = event.dataTransfer;
                        if (!item.conversationId || !item.sourceFolderId || !transfer) return event.preventDefault();
                        transfer.effectAllowed = "move";
                        transfer.setData(
                          "application/x-cloud-mail-conversation",
                          JSON.stringify({
                            conversationId: item.conversationId,
                            sourceFolderId: item.sourceFolderId,
                          }),
                        );
                      }}
                    >
                      <span class="sr-only">
                        {item.unread ? "Unread conversation. " : "Read conversation. "}
                        {item.flagged ? "Flagged conversation. " : ""}
                      </span>
                      <span class="mail-list-copy">
                        <span
                          class="flex min-w-0 items-center gap-1 text-sm text-primary"
                          classList={{ "font-semibold": item.unread, "font-medium": !item.unread }}
                        >
                          <Show when={item.unread}>
                            <span class="mail-list-unread-dot" aria-hidden="true" />
                          </Show>
                          <span class="min-w-0 truncate">{primaryCorrespondent}</span>
                          <Show when={additionalCorrespondents > 0}>
                            <Tooltip content={correspondents.join(", ")}>
                              <span
                                class="shrink-0 text-xs font-normal text-dimmed"
                                role="img"
                                aria-label={`${additionalCorrespondents} additional correspondent${additionalCorrespondents === 1 ? "" : "s"}: ${correspondents
                                  .slice(1)
                                  .join(", ")}`}
                              >
                                +{additionalCorrespondents}
                              </span>
                            </Tooltip>
                          </Show>
                        </span>
                        <span class="min-w-0 truncate text-xs font-medium text-primary">
                          <Show when={item.primaryReference}>
                            <span class="mr-1 font-mono text-[0.6875rem] text-dimmed">{item.primaryReference}</span>
                          </Show>
                          {item.subject || "(no subject)"}
                        </span>
                        <span class="mail-list-preview">{item.preview || "\u00a0"}</span>
                      </span>
                      <span class="mail-list-meta transition-opacity group-focus-within:opacity-0 group-hover:opacity-0">
                        <time
                          class="shrink-0 tabular-nums"
                          dateTime={item.latestMessageAt}
                          title={dates.formatDateTime(item.latestMessageAt, props.dateConfig)}
                        >
                          {dates.formatDateTimeRelative(item.latestMessageAt, props.dateConfig)}
                        </time>
                        <span class="mail-list-meta-icons">
                          <Show when={item.localTags.length > 0}>
                            <Tooltip content={`Tags: ${tagLabel}`}>
                              <span class="mail-list-tag-markers" role="img" aria-label={`Tags: ${tagLabel}`}>
                                <For each={item.localTags.slice(0, 2)}>
                                  {(tag) => <span class="mail-list-tag-dot" style={{ "background-color": tag.color }} aria-hidden="true" />}
                                </For>
                                <Show when={item.localTags.length > 2}>
                                  <span class="mail-list-tag-overflow" aria-hidden="true">
                                    +{item.localTags.length - 2}
                                  </span>
                                </Show>
                              </span>
                            </Tooltip>
                          </Show>
                          <Show when={item.flagged}>
                            <Tooltip content="Flagged">
                              <span class="inline-flex text-orange-600 dark:text-orange-400" role="img" aria-label="Flagged conversation">
                                <i class={getMailAction("flag").icon} aria-hidden="true" />
                              </span>
                            </Tooltip>
                          </Show>
                          <Show when={state && stateIcon}>
                            <Tooltip content={state ?? ""}>
                              <span class="inline-flex" role="img" aria-label={`Status: ${state}`}>
                                <i class={stateIcon ?? ""} aria-hidden="true" />
                              </span>
                            </Tooltip>
                          </Show>
                          <Show when={item.hasAttachments}>
                            <Tooltip content="Has attachments">
                              <span class="inline-flex" role="img" aria-label="Has attachments">
                                <i class="ti ti-paperclip" aria-hidden="true" />
                              </span>
                            </Tooltip>
                          </Show>
                        </span>
                      </span>
                    </a>
                    <Show when={props.canWrite && !props.selectionMode && item.conversationId}>
                      <div class="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                        <Dropdown
                          trigger={
                            <button
                              type="button"
                              class="icon-btn icon-btn-sm bg-[var(--ui-surface)]"
                              aria-label={`Actions for ${item.subject || "conversation"}`}
                            >
                              <i class="ti ti-dots" aria-hidden="true" />
                            </button>
                          }
                          position="bottom-left"
                          width="w-52"
                          elements={[
                            {
                              label: getMailAction(item.unread ? "mark_read" : "mark_unread").label,
                              icon: getMailAction(item.unread ? "mark_read" : "mark_unread").icon,
                              action: () => props.onItemAction(item, item.unread ? "mark_read" : "mark_unread"),
                            },
                            {
                              label: getMailAction(item.flagged ? "unflag" : "flag").label,
                              icon: getMailAction(item.flagged ? "unflag" : "flag").icon,
                              action: () => props.onItemAction(item, item.flagged ? "unflag" : "flag"),
                            },
                            {
                              label: "Manage tags",
                              icon: "ti ti-tags",
                              action: () => props.onManageTags(item),
                            },
                            ...(["archive", "move", "junk", "trash"] as const).map((actionId) => ({
                              label: getMailAction(actionId).label,
                              icon: getMailAction(actionId).icon,
                              action: () => props.onItemAction(item, actionId),
                            })),
                            {
                              label: "Merge with another conversation",
                              icon: "ti ti-git-merge",
                              action: () => props.onMergeItem(item),
                            },
                          ]}
                        />
                      </div>
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
        )}
        <Show when={nextHref()}>
          {(href) => (
            <div ref={(element) => setLoadMoreElement(element)} class="flex min-h-14 items-center justify-center py-3">
              <a
                href={href()}
                class="btn-secondary btn-sm"
                aria-disabled={props.loading}
                onClick={(event) => {
                  if (!props.loading) {
                    event.preventDefault();
                    requestedLoadHref = null;
                    void loadNextPage(href());
                  }
                }}
              >
                <i
                  class={
                    props.loading ? "ti ti-loader-2 animate-spin" : failedLoadHref() === href() ? "ti ti-refresh" : "ti ti-chevron-down"
                  }
                  aria-hidden="true"
                />
                {props.loading ? "Loading conversations" : failedLoadHref() === href() ? "Retry loading" : "More conversations"}
              </a>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}
