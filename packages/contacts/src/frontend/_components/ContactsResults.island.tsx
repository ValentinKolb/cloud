import { Pagination, TextInput } from "@valentinkolb/cloud/ui";
import { documentNavigate, navigate } from "@valentinkolb/ssr/nav";
import { mutation as mutations, timed } from "@valentinkolb/stdlib/solid";
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Contact, ContactTag } from "../../service";
import { readErrorMessage } from "./api";
import ContactsList from "./ContactsList";
import ContactTagChip from "./ContactTagChip";
import { buildContactsPaginationBaseHref, buildContactsSearchHref, contactsResultSignature } from "./contacts-search";
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
};

type ResultState = {
  contacts: Contact[];
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

const filterHref = (basePath: string, search: string, tagId?: string) => {
  const params = new URLSearchParams();
  if (search.trim()) params.set("search", search.trim());
  if (tagId) params.set("tag_id", tagId);
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
};

const fetchContactsResults = async (props: Pick<Props, "bookId" | "perPage">, href: string, signal: AbortSignal) => {
  const url = new URL(href, window.location.origin);
  const queryParams = {
    q: url.searchParams.get("search") || undefined,
    page: url.searchParams.get("page") ?? "1",
    per_page: String(props.perPage),
  };
  const response = props.bookId
    ? await apiClient.books[":bookId"].contacts.$get(
        {
          param: { bookId: props.bookId },
          query: { ...queryParams, tag_id: url.searchParams.get("tag_id") || undefined },
        },
        { init: { signal } },
      )
    : await apiClient.search.$get({ query: queryParams }, { init: { signal } });
  if (!response.ok) throw new Error(await readErrorMessage(response, "Could not update contacts"));
  return await response.json();
};

export default function ContactsResults(props: Props) {
  const [state, setState] = createSignal<ResultState>({
    contacts: props.initialContacts,
    total: props.initialTotal,
    page: props.initialPage,
    totalPages: props.initialTotalPages,
    href: props.initialHref,
  });
  const [query, setQuery] = createSignal(props.initialSearch);
  const [focused, setFocused] = createSignal(false);
  let requestVersion = 0;

  const routeMutation = mutations.create<LoadResult, LoadRequest, { request: LoadRequest }>({
    onBefore: (request) => ({ request }),
    mutation: async (request, ctx) => ({
      request,
      payload: await fetchContactsResults(props, request.href, ctx.abortSignal),
    }),
    onSuccess: ({ request, payload }) => {
      if (request.version !== requestVersion) return;
      setState({
        contacts: payload.data,
        total: payload.pagination.total,
        page: payload.pagination.page,
        totalPages: Math.max(1, payload.pagination.total_pages),
        href: request.href,
      });
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

  const loadHref = (href: string, options: { commit?: boolean; fallback?: boolean } = {}) => {
    routeMutation.mutate({
      href,
      version: requestVersion,
      commit: options.commit !== false,
      fallback: options.fallback !== false,
    });
  };

  const debounce = timed.debounce((value: string) => {
    loadHref(buildContactsSearchHref(pathWithQuery(), value));
  }, 200);

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
      loadHref(href, { commit: false, fallback: true });
    };
    window.addEventListener("popstate", handlePopState);
    onCleanup(() => {
      debounce.cancel();
      window.removeEventListener("popstate", handlePopState);
    });
  });

  const commitImmediately = (value: string) => {
    debounce.cancel();
    requestVersion += 1;
    loadHref(buildContactsSearchHref(pathWithQuery(), value));
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
            ariaLabel="Filter contacts"
            placeholder={props.searchPlaceholder}
            icon="ti ti-search"
            activeIcon="ti ti-search"
            value={query}
            onInput={(value) => {
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
        </form>
        <Show when={(props.tags?.length ?? 0) > 0 && props.filtersBasePath}>
          <nav aria-label="Filter contacts by tag" class="mt-2 flex min-w-0 items-center gap-1.5 overflow-x-auto pb-0.5">
            <a
              href={filterHref(props.filtersBasePath!, query())}
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
                href={filterHref(props.filtersBasePath!, query(), tag.id)}
                aria-current={props.activeTagId === tag.id ? "page" : undefined}
                class="inline-flex shrink-0 transition-opacity hover:opacity-80"
              >
                <ContactTagChip name={tag.name} color={tag.color} active={props.activeTagId === tag.id} size="sm" />
              </a>
            ))}
          </nav>
        </Show>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto border-t border-[var(--ui-divider)]" data-scroll-preserve="contacts-main-list">
        <ContactsList
          contacts={state().contacts}
          bookNames={props.bookNames}
          showBookNames={props.showBookNames}
          initialSelectedContactId={props.initialSelectedContactId}
          initialSelectedBookId={props.initialSelectedBookId}
          detailBaseHref={state().href}
          emptyTitle={committedSearch().trim() ? "No matching contacts" : "No contacts yet"}
          emptyDescription={
            committedSearch().trim()
              ? "Try a different name, company, email address, or phone number."
              : "Create the first contact from the action above."
          }
        />
      </div>

      <Show when={state().totalPages > 1}>
        <div class="shrink-0 border-t border-[var(--ui-divider)] px-3 py-2">
          <Pagination currentPage={state().page} totalPages={state().totalPages} baseUrl={buildContactsPaginationBaseHref(state().href)} />
        </div>
      </Show>
    </div>
  );
}
