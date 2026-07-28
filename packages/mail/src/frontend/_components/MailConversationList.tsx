import { Link, type LinkNavigateEvent } from "@k2b/ssr/nav";
import { FilterChip, Placeholder, TextInput, Tooltip } from "@valentinkolb/cloud/ui";
import type { DateContext } from "@valentinkolb/stdlib";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { Mailbox } from "../../contracts";
import {
  DEFAULT_MAIL_QUICK_SEARCH_FIELDS,
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
import MailConversationRow from "./MailConversationRow";
import { openMailSearchBuilder } from "./MailSearchBuilder";
import type { MailActionId } from "./mail-actions";
import { mailboxHealthPresentation } from "./mail-health-presentation";
import { buildMailListHref, type MailListItem } from "./mail-navigation";
import { summarizeMailSearchExpression } from "./mail-search-builder-model";

const QUICK_SEARCH_FIELD_OPTIONS = [
  { value: "from", label: "Sender", icon: "ti ti-user-up" },
  { value: "recipients", label: "Recipients", icon: "ti ti-user-down" },
  { value: "subject", label: "Subject", icon: "ti ti-letter-case" },
  { value: "body", label: "Message body", icon: "ti ti-align-left" },
  { value: "attachment_name", label: "Attachments", icon: "ti ti-paperclip" },
] satisfies Array<{ value: MailQuickSearchField; label: string; icon: string }>;

const selectedQuickSearchFields = (url: URL): MailQuickSearchField[] => {
  const fields = parseMailQuickSearchFields(url);
  return fields.length > 0 ? fields : [...DEFAULT_MAIL_QUICK_SEARCH_FIELDS];
};

const DEFAULT_QUICK_SEARCH_FIELD_SET = new Set<MailQuickSearchField>(DEFAULT_MAIL_QUICK_SEARCH_FIELDS);
const isDefaultQuickSearch = (fields: MailQuickSearchField[]): boolean =>
  fields.length === DEFAULT_MAIL_QUICK_SEARCH_FIELDS.length && fields.every((field) => DEFAULT_QUICK_SEARCH_FIELD_SET.has(field));

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
  canAdmin: boolean;
  junkFolderIds: string[];
  savedViews: SavedConversationView[];
  activeSavedViewId: string | null;
  loading: boolean;
  liveDegraded: boolean;
  onCollapse: () => void;
  onOpenHealth: () => void;
  onOpenDeliverySettings: () => void;
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
  const healthPresentation = createMemo(() => mailboxHealthPresentation(props.mailbox));
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
      if (!isDefaultQuickSearch(fields)) next.searchParams.set(MAIL_QUICK_SEARCH_FIELDS_PARAMETER, fields.join(","));
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
    const allowed = new Set<string>(MAIL_QUICK_SEARCH_FIELDS);
    const selected = next.filter((field): field is MailQuickSearchField => allowed.has(field));
    const normalized = selected.length > 0 ? selected : [...DEFAULT_MAIL_QUICK_SEARCH_FIELDS];
    setSearchFields(normalized);
    if (searchValue().trim()) applyQuickSearch(searchValue(), normalized);
  };
  const searchFieldsLabel = () =>
    QUICK_SEARCH_FIELD_OPTIONS.filter((option) => searchFields().includes(option.value))
      .map((option) => option.label)
      .join(", ");

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
                <p class="flex min-w-0 items-center gap-1 overflow-hidden text-xs text-dimmed">
                  <span class="shrink-0 whitespace-nowrap">{props.items.length} shown</span>
                  <Show when={props.loading}>
                    <i class="ti ti-loader-2 shrink-0 animate-spin" aria-hidden="true" />
                    <span class="sr-only">Loading view</span>
                  </Show>
                  <Show when={props.liveDegraded}>
                    <span class="inline-flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap" title="Live updates paused">
                      <i class="ti ti-cloud-off shrink-0" aria-hidden="true" />
                      <span class="truncate">Updates paused</span>
                    </span>
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
              <Show when={props.selectedConversationId || props.selectedMessageId}>
                <Tooltip content="Hide conversation list">
                  <button
                    type="button"
                    class="icon-btn hidden lg:inline-flex"
                    aria-label="Hide conversation list"
                    onClick={props.onCollapse}
                  >
                    <i class="ti ti-layout-sidebar-left-collapse" aria-hidden="true" />
                  </button>
                </Tooltip>
              </Show>
            </div>
          }
        >
          <MailBulkActionBar
            selectedCount={props.selectedConversationIds.size}
            selectedInJunk={
              props.selectedConversationIds.size > 0 &&
              props.items
                .filter((item) => item.conversationId && props.selectedConversationIds.has(item.conversationId))
                .every((item) => Boolean(item.sourceFolderId && props.junkFolderIds.includes(item.sourceFolderId)))
            }
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
          <FilterChip
            label={`Search in: ${searchFieldsLabel()}`}
            icon="ti ti-filter-search"
            options={[{ label: "Search in", options: QUICK_SEARCH_FIELD_OPTIONS, multiple: true }]}
            value={searchFields()}
            defaultValue={[...DEFAULT_MAIL_QUICK_SEARCH_FIELDS]}
            isActive={!isDefaultQuickSearch(searchFields())}
            onChange={updateSearchFields}
            position="bottom-right"
            iconOnly
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
        <Show when={healthPresentation()}>
          {(health) => (
            <div class={`info-block-${health().tone} text-xs`} role="status" data-mailbox-health={props.mailbox.health}>
              <div class="flex min-w-0 items-start gap-2">
                <i
                  class={`ti ${health().tone === "warning" ? "ti-alert-triangle" : "ti-info-circle"} mt-0.5 shrink-0`}
                  aria-hidden="true"
                />
                <div class="min-w-0">
                  <p>
                    <strong class="font-semibold text-primary">{health().title}.</strong> {health().message}
                  </p>
                  <Show when={props.canAdmin && health().action && health().actionLabel}>
                    <button
                      type="button"
                      class="k2b-status-badge focus-ui mt-2 cursor-pointer transition-colors hover:bg-[var(--ui-hover)]"
                      data-tone="neutral"
                      data-variant="chip"
                      aria-label={health().actionLabel ?? undefined}
                      title={health().actionLabel ?? undefined}
                      onClick={() => (health().action === "delivery" ? props.onOpenDeliverySettings() : props.onOpenHealth())}
                    >
                      <i class="ti ti-activity" aria-hidden="true" />
                      <span class="k2b-status-badge__label">{health().action === "health" ? "Status" : health().actionLabel}</span>
                    </button>
                  </Show>
                </div>
              </div>
            </div>
          )}
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
              {(item) => (
                <MailConversationRow
                  item={item}
                  requestUrl={requestUrl()}
                  state={{
                    selectedConversationId: props.selectedConversationId,
                    selectedMessageId: props.selectedMessageId,
                    selectedConversationIds: props.selectedConversationIds,
                    selectionMode: props.selectionMode,
                    canWrite: props.canWrite,
                    junkFolderIds: props.junkFolderIds,
                    dateConfig: props.dateConfig,
                  }}
                  actions={{
                    navigate: props.onNavigateItem,
                    toggleSelection: props.onToggleSelection,
                    itemAction: props.onItemAction,
                    manageTags: props.onManageTags,
                    merge: props.onMergeItem,
                    prefetch: props.onPrefetch,
                  }}
                />
              )}
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
