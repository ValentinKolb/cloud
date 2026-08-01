import { documentNavigate, navigate } from "@k2b/ssr/nav";
import { mutation as mutations, timed } from "@k2b/stdlib/solid";
import { FilterChip, type FilterChipSection, Pagination, TextInput } from "@k2b/ui";
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Contact, ContactPresenceFilter, ContactSort, ContactTag } from "../../service";
import { buildContactsQueryHref, readContactsQueryOptions } from "../contacts-query";
import { readErrorMessage } from "./api";
import { openContactDuplicatesDialog } from "./ContactDuplicatesDialog";
import ContactsBulkActions from "./ContactsBulkActions";
import ContactsList from "./ContactsList";
import ContactTagChip from "./ContactTagChip";
import { listenForContactFavoriteChanges } from "./contacts-favorites";
import { listenForContactsLiveInvalidation, requiresContactsResultsRefresh } from "./contacts-live";
import {
  buildContactsPageHref,
  buildContactsPaginationBaseHref,
  buildContactsSearchHref,
  contactsResultSignature,
} from "./contacts-search";
import { syncContactDetailFromUrl } from "./context";

type Props = {
  bookId?: string;
  initialSearch: string;
  initialHref: string;
  initialContacts: Contact[];
  initialTotal: number;
  initialPage: number;
  initialTotalPages: number;
  perPage: number;
  bookNames: Record<string, string>;
  showBookNames?: boolean;
  initialSelectedContactId: string | null;
  initialSelectedBookId: string | null;
  searchPlaceholder: string;
  tags?: ContactTag[];
  activeTagId?: string | null;
  filtersBasePath?: string;
  initialFavoriteKeys: string[];
  canWrite: boolean;
  writableBooks: Array<{ id: string; name: string }>;
};

type ResultState = {
  contacts: Contact[];
  favoriteKeys: string[];
  total: number;
  page: number;
  totalPages: number;
  href: string;
};

type LoadRequest = {
  href: string;
  version: number;
  commit: boolean;
  fallback: boolean;
};

type LoadResult = {
  request: LoadRequest;
  payload: Awaited<ReturnType<typeof fetchContactsResults>>;
};

const pathWithQuery = () => `${window.location.pathname}${window.location.search}`;

const filterHref = (href: string, search: string, tagId?: string) => {
  const url = new URL(href, "http://contacts.local");
  if (search.trim()) url.searchParams.set("search", search.trim());
  else url.searchParams.delete("search");
  if (tagId) url.searchParams.set("tag_id", tagId);
  else url.searchParams.delete("tag_id");
  url.searchParams.delete("page");
  url.searchParams.delete("contact");
  url.searchParams.delete("contactBook");
  return `${url.pathname}${url.search}`;
};

const SORT_OPTIONS: FilterChipSection[] = [
  {
    options: [
      { value: "name", label: "Name", icon: "ti ti-sort-ascending-letters" },
      { value: "updated", label: "Recently updated", icon: "ti ti-history" },
      { value: "created", label: "Recently created", icon: "ti ti-clock-plus" },
      { value: "company", label: "Company", icon: "ti ti-building" },
    ],
  },
];

const REACH_OPTIONS: FilterChipSection[] = [
  {
    label: "Email",
    options: [
      { value: "email:all", label: "Any email" },
      { value: "email:yes", label: "Has email", icon: "ti ti-mail-check" },
      { value: "email:no", label: "No email", icon: "ti ti-mail-off" },
    ],
  },
  {
    label: "Phone",
    options: [
      { value: "phone:all", label: "Any phone" },
      { value: "phone:yes", label: "Has phone", icon: "ti ti-phone-check" },
      { value: "phone:no", label: "No phone", icon: "ti ti-phone-off" },
    ],
  },
];

const fetchContactsResults = async (props: Pick<Props, "bookId" | "perPage">, href: string, signal: AbortSignal) => {
  const url = new URL(href, window.location.origin);
  const options = readContactsQueryOptions(href);
  const queryParams = {
    q: url.searchParams.get("search") || undefined,
    tag_id: url.searchParams.get("tag_id") || undefined,
    page: url.searchParams.get("page") ?? "1",
    per_page: String(props.perPage),
    sort: options.sort === "name" ? undefined : options.sort,
    email: options.email === "all" ? undefined : options.email,
    phone: options.phone === "all" ? undefined : options.phone,
    favorites: options.favorites ? ("true" as const) : undefined,
  };
  const response = props.bookId
    ? await apiClient.books[":bookId"].contacts.$get(
        {
          param: { bookId: props.bookId },
          query: queryParams,
        },
        { init: { signal } },
      )
    : await apiClient.search.$get(
        { query: { ...queryParams, includeSystem: options.favorites ? "true" : undefined } },
        { init: { signal } },
      );
  if (!response.ok) throw new Error(await readErrorMessage(response, "Could not update contacts"));
  return await response.json();
};

export default function ContactsResults(props: Props) {
  const [state, setState] = createSignal<ResultState>({
    contacts: props.initialContacts,
    favoriteKeys: props.initialFavoriteKeys,
    total: props.initialTotal,
    page: props.initialPage,
    totalPages: props.initialTotalPages,
    href: props.initialHref,
  });
  const [query, setQuery] = createSignal(props.initialSearch);
  const [focused, setFocused] = createSignal(false);
  const [selectionMode, setSelectionMode] = createSignal(false);
  const [selectedIds, setSelectedIds] = createSignal<string[]>([]);
  let requestVersion = 0;

  const routeMutation = mutations.create<LoadResult, LoadRequest, { request: LoadRequest }>({
    onBefore: (request) => ({ request }),
    mutation: async (request, ctx) => ({
      request,
      payload: await fetchContactsResults(props, request.href, ctx.abortSignal),
    }),
    onSuccess: ({ request, payload }) => {
      if (request.version !== requestVersion) return;
      const totalPages = Math.max(1, payload.pagination.total_pages);
      if (payload.pagination.page > totalPages) {
        requestVersion += 1;
        queueMicrotask(() => {
          void loadHref(buildContactsPageHref(request.href, totalPages), {
            commit: request.commit,
            fallback: request.fallback,
          });
        });
        return;
      }
      setState({
        contacts: payload.data,
        favoriteKeys: payload.favoriteKeys,
        total: payload.pagination.total,
        page: payload.pagination.page,
        totalPages,
        href: request.href,
      });
      const visibleIds = new Set(payload.data.map((contact) => contact.id));
      setSelectedIds((current) => current.filter((id) => visibleIds.has(id)));
      setQuery(new URL(request.href, window.location.origin).searchParams.get("search") ?? "");
      if (request.commit) {
        navigate(request.href, { replace: true, scroll: "preserve" });
        syncContactDetailFromUrl();
      }
    },
    onError: (_error, ctx) => {
      if (ctx?.request.version === requestVersion && ctx.request.fallback) {
        documentNavigate(ctx.request.href, { replace: true });
      }
    },
  });

  const loadHref = async (href: string, options: { commit?: boolean; fallback?: boolean; throwOnError?: boolean } = {}) => {
    const request = {
      href,
      version: requestVersion,
      commit: options.commit !== false,
      fallback: options.fallback !== false,
    };
    await routeMutation.mutate(request);
    if (options.throwOnError && request.version === requestVersion && routeMutation.error()) throw routeMutation.error();
  };

  const debounce = timed.debounce((value: string) => {
    void loadHref(buildContactsSearchHref(pathWithQuery(), value));
  }, 200);

  const refreshLiveResults = async () => {
    requestVersion += 1;
    await loadHref(state().href, { commit: false, fallback: false, throwOnError: true });
  };

  createEffect(() => {
    if (!focused() && !debounce.isPending() && !routeMutation.loading()) {
      setQuery(new URL(state().href, "http://contacts.local").searchParams.get("search") ?? "");
    }
  });

  onMount(() => {
    const handlePopState = () => {
      const href = pathWithQuery();
      if (contactsResultSignature(href) === contactsResultSignature(state().href)) return;
      requestVersion += 1;
      void loadHref(href, { commit: false, fallback: true });
    };
    window.addEventListener("popstate", handlePopState);
    const stopLiveInvalidations = listenForContactsLiveInvalidation((event) => {
      if (requiresContactsResultsRefresh(event)) return refreshLiveResults();
    });
    const stopFavoriteChanges = listenForContactFavoriteChanges((change) => {
      if (readContactsQueryOptions(state().href).favorites) return refreshLiveResults();
    });
    onCleanup(() => {
      debounce.cancel();
      stopLiveInvalidations();
      stopFavoriteChanges();
      window.removeEventListener("popstate", handlePopState);
    });
  });

  const commitImmediately = (value: string) => {
    debounce.cancel();
    requestVersion += 1;
    void loadHref(buildContactsSearchHref(pathWithQuery(), value));
  };

  const updateOptions = (patch: Parameters<typeof buildContactsQueryHref>[1]) => {
    const href = buildContactsQueryHref(state().href, patch);
    if (!props.bookId && patch.favorites !== undefined) {
      documentNavigate(href, { replace: true });
      return;
    }
    requestVersion += 1;
    void loadHref(href);
  };

  const clearSelection = () => {
    setSelectedIds([]);
    setSelectionMode(false);
  };
  const toggleSelection = (contactId: string) => {
    setSelectedIds((current) => (current.includes(contactId) ? current.filter((id) => id !== contactId) : [...current, contactId]));
  };
  const selectVisible = () => setSelectedIds(state().contacts.map((contact) => contact.id));
  const refreshResults = async () => {
    requestVersion += 1;
    await loadHref(state().href, { commit: false, fallback: false, throwOnError: true });
  };

  const committedSearch = () => new URL(state().href, "http://contacts.local").searchParams.get("search") ?? "";
  const formAction = () => new URL(props.initialHref, "http://contacts.local").pathname;
  const resultCopy = () =>
    committedSearch().trim()
      ? `${state().total} result${state().total === 1 ? "" : "s"} for “${committedSearch().trim()}”`
      : `${state().total} contact${state().total === 1 ? "" : "s"}`;

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="shrink-0 px-3 pb-3 sm:px-4">
        <p class="mb-2 text-xs text-dimmed" aria-live="polite">
          <span class="tabular-nums text-secondary">{resultCopy()}</span>
        </p>
        <form
          role="search"
          action={formAction()}
          method="get"
          onSubmit={(event) => {
            event.preventDefault();
            commitImmediately(query());
          }}
          onFocusIn={() => setFocused(true)}
          onFocusOut={() => setFocused(false)}
        >
          <TextInput
            name="search"
            type="search"
            aria-label="Filter contacts"
            placeholder={props.searchPlaceholder}
            icon="ti ti-search"
            activeIcon="ti ti-search"
            value={query}
            onValueChange={(value) => {
              requestVersion += 1;
              setQuery(value);
              debounce.debouncedFn(value);
            }}
            clearable
            clearLabel="Clear search"
            onClear={() => {
              setQuery("");
              commitImmediately("");
            }}
            suffix={
              debounce.isPending() || routeMutation.loading() ? (
                <i class="ti ti-loader-2 animate-spin text-dimmed" aria-hidden="true" />
              ) : undefined
            }
          />
          <Show when={props.activeTagId}>{(tagId) => <input type="hidden" name="tag_id" value={tagId()} />}</Show>
          <Show when={readContactsQueryOptions(state().href).sort !== "name"}>
            <input type="hidden" name="sort" value={readContactsQueryOptions(state().href).sort} />
          </Show>
          <Show when={readContactsQueryOptions(state().href).email !== "all"}>
            <input type="hidden" name="email" value={readContactsQueryOptions(state().href).email} />
          </Show>
          <Show when={readContactsQueryOptions(state().href).phone !== "all"}>
            <input type="hidden" name="phone" value={readContactsQueryOptions(state().href).phone} />
          </Show>
          <Show when={readContactsQueryOptions(state().href).favorites}>
            <input type="hidden" name="favorites" value="true" />
          </Show>
        </form>
        <Show when={(props.tags?.length ?? 0) > 0 && props.filtersBasePath}>
          <nav aria-label="Filter contacts by tag" class="mt-2 flex min-w-0 items-center gap-1.5 overflow-x-auto pb-0.5">
            <a
              href={filterHref(state().href, query())}
              aria-current={!props.activeTagId ? "page" : undefined}
              class={`inline-flex h-6 shrink-0 items-center rounded-full border px-2 text-xs font-medium transition-colors ${
                props.activeTagId
                  ? "border-[var(--ui-border)] bg-[var(--ui-surface-muted)] text-secondary hover:bg-[var(--ui-hover)]"
                  : "border-transparent bg-[var(--ui-selected)] text-primary"
              }`}
            >
              All
            </a>
            {props.tags?.map((tag) => (
              <a
                href={filterHref(state().href, query(), tag.id)}
                aria-current={props.activeTagId === tag.id ? "page" : undefined}
                title={props.showBookNames ? `${tag.name} · ${props.bookNames[tag.bookId] ?? "Contact book"}` : undefined}
                class="inline-flex shrink-0 transition-opacity hover:opacity-80"
              >
                <ContactTagChip name={tag.name} color={tag.color} active={props.activeTagId === tag.id} size="sm" />
              </a>
            ))}
          </nav>
        </Show>
        <div class="no-scrollbar mt-2 flex items-center gap-2 overflow-x-auto pb-0.5 sm:flex-wrap sm:overflow-visible">
          <FilterChip
            label="Sort"
            icon="ti ti-arrows-sort"
            options={SORT_OPTIONS}
            value={[readContactsQueryOptions(state().href).sort]}
            defaultValue={["name"]}
            isActive={readContactsQueryOptions(state().href).sort !== "name"}
            onValueChange={(value) => updateOptions({ sort: (value[0] ?? "name") as ContactSort })}
          />
          <FilterChip
            label="Contact info"
            icon="ti ti-address-book"
            options={REACH_OPTIONS}
            value={[`email:${readContactsQueryOptions(state().href).email}`, `phone:${readContactsQueryOptions(state().href).phone}`]}
            defaultValue={["email:all", "phone:all"]}
            isActive={readContactsQueryOptions(state().href).email !== "all" || readContactsQueryOptions(state().href).phone !== "all"}
            onValueChange={(value) =>
              updateOptions({
                email: (value.find((entry) => entry.startsWith("email:"))?.slice(6) ?? "all") as ContactPresenceFilter,
                phone: (value.find((entry) => entry.startsWith("phone:"))?.slice(6) ?? "all") as ContactPresenceFilter,
              })
            }
          />
          <Show when={props.canWrite && props.bookId}>
            <span class="ml-auto flex items-center gap-2">
              <button
                type="button"
                class="btn-simple btn-sm"
                onClick={async () => {
                  const changed = await openContactDuplicatesDialog(props.bookId!);
                  if (changed) documentNavigate(state().href, { replace: true });
                }}
              >
                <i class="ti ti-users-group" /> Duplicates
              </button>
              <button
                type="button"
                class="btn-simple btn-sm"
                aria-pressed={selectionMode()}
                onClick={() => (selectionMode() ? clearSelection() : setSelectionMode(true))}
              >
                <i class="ti ti-list-check" /> Select
              </button>
            </span>
          </Show>
        </div>
        <Show when={selectionMode() && props.bookId}>
          <ContactsBulkActions
            bookId={props.bookId!}
            selectedIds={selectedIds}
            visibleIds={() => state().contacts.map((contact) => contact.id)}
            tags={props.tags ?? []}
            writableBooks={props.writableBooks}
            onSelectVisible={selectVisible}
            onClear={clearSelection}
            onChanged={refreshResults}
          />
        </Show>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-3 sm:px-4" data-scroll-preserve="contacts-main-list">
        <ContactsList
          contacts={state().contacts}
          bookNames={props.bookNames}
          showBookNames={props.showBookNames}
          initialSelectedContactId={props.initialSelectedContactId}
          initialSelectedBookId={props.initialSelectedBookId}
          detailBaseHref={state().href}
          initialFavoriteKeys={state().favoriteKeys}
          selectionMode={selectionMode()}
          selectedIds={selectedIds()}
          onToggleSelection={toggleSelection}
          emptyTitle={committedSearch().trim() ? "No matching contacts" : "No contacts yet"}
          emptyDescription={
            committedSearch().trim()
              ? "Try a different name, company, email address, or phone number."
              : "Create the first contact from the action above."
          }
        />
        <Show when={state().totalPages > 1}>
          <div class="pt-3">
            <Pagination
              currentPage={state().page}
              totalPages={state().totalPages}
              baseUrl={buildContactsPaginationBaseHref(state().href)}
            />
          </div>
        </Show>
      </div>
    </div>
  );
}
