import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { dialogCore } from "@valentinkolb/cloud-lib/ui";
import { mutation, timing } from "@valentinkolb/cloud-lib/browser";
import { openGlobalSearchHelpDialog, type GlobalSearchHelpApp } from "./GlobalSearchHelpDialog";

type SearchMetadata = {
  label: string;
  value: string;
};

type SearchItem = {
  appId: string;
  appName: string;
  appIcon: string;
  id: string;
  title: string;
  href: string;
  preview?: string;
  icon?: string;
  priority?: number;
  metadata?: SearchMetadata[];
  previewUrl?: string;
};

type SearchResponse = {
  query: string;
  count: number;
  items: SearchItem[];
};

type ParsedInput = {
  query: string;
  tags: string[];
};

type GlobalSearchDialogProps = {
  close: () => void;
  helpApps: GlobalSearchHelpApp[];
};

const PROVIDER_LIMIT = 10;
const MIN_QUERY_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 200;
const TAG_TOKEN_PATTERN = /^[^\s#]+$/;

const rowKey = (item: SearchItem) => `row:${item.appId}:${item.id}`;
const isValidImagePreviewUrl = (url?: string) => typeof url === "string" && url.startsWith("/");
const sortByPriorityAndTitle = (a: SearchItem, b: SearchItem) => {
  const byPriority = (b.priority ?? 0) - (a.priority ?? 0);
  if (byPriority !== 0) return byPriority;
  return a.title.localeCompare(b.title);
};

const parseInput = (raw: string): ParsedInput => {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  const tags: string[] = [];
  const queryTokens: string[] = [];

  for (const token of tokens) {
    if (token.startsWith("#") && token.length > 1) {
      const tag = token.slice(1).toLowerCase();
      if (TAG_TOKEN_PATTERN.test(tag)) {
        tags.push(tag);
        continue;
      }
    }

    queryTokens.push(token);
  }

  return {
    query: queryTokens.join(" "),
    tags: [...new Set(tags)],
  };
};

const metadataRows = (metadata?: SearchMetadata[]) =>
  (metadata ?? [])
    .filter((entry) => entry.label.trim().length > 0 && entry.value.trim().length > 0)
    .slice(0, 5);

export default function GlobalSearchDialog(props: GlobalSearchDialogProps) {
  const [rawInput, setRawInput] = createSignal("");
  const [resultItems, setResultItems] = createSignal<SearchItem[]>([]);
  const [activeIndex, setActiveIndex] = createSignal(0);
  const [previewFailed, setPreviewFailed] = createSignal(false);
  const [requestError, setRequestError] = createSignal<string | null>(null);

  let inputRef: HTMLInputElement | undefined;
  const rowRefs = new Map<string, HTMLButtonElement>();

  const parsedInput = createMemo(() => parseInput(rawInput()));
  const canSearch = createMemo(
    () => parsedInput().tags.length > 0 || parsedInput().query.length >= MIN_QUERY_LENGTH,
  );
  const shouldShowList = createMemo(() => canSearch());

  const searchMutation = mutation.create<SearchResponse, ParsedInput>({
    mutation: async (input, ctx) => {
      const params = new URLSearchParams({ provider_limit: String(PROVIDER_LIMIT) });
      if (input.query.length > 0) params.set("q", input.query);
      for (const tag of input.tags) params.append("tag", tag);

      const response = await fetch(`/api/search?${params.toString()}`, {
        signal: ctx.abortSignal,
      });

      const payload = (await response.json()) as SearchResponse | { message?: string };
      if (!response.ok) {
        throw new Error("message" in payload ? payload.message ?? "Search failed." : "Search failed.");
      }

      return payload as SearchResponse;
    },
    onSuccess: (payload) => {
      setResultItems((payload.items ?? []).slice().sort(sortByPriorityAndTitle));
      setActiveIndex(0);
      setRequestError(null);
    },
    onError: (error) => {
      if (error.name === "AbortError") return;
      setResultItems([]);
      setActiveIndex(0);
      setRequestError(error.message || "Search failed.");
    },
  });

  const activeItem = createMemo(() => resultItems()[activeIndex()] ?? null);

  const { debouncedFn: debounceSearch, cancel: cancelDebounce } = timing.debounce((input: ParsedInput) => {
    setResultItems([]);
    setActiveIndex(0);
    searchMutation.abort();
    void searchMutation.mutate(input);
  }, SEARCH_DEBOUNCE_MS);

  const bindRowRef = (key: string, element?: HTMLButtonElement) => {
    if (!element) {
      rowRefs.delete(key);
      return;
    }
    rowRefs.set(key, element);
  };

  const openHelp = () => {
    props.close();
    queueMicrotask(() => {
      openGlobalSearchHelpDialog(props.helpApps);
    });
  };

  const openItem = (row?: SearchItem) => {
    if (!row) return;
    props.close();
    window.location.href = row.href;
  };

  const moveSelection = (delta: -1 | 1) => {
    const list = resultItems();
    if (list.length === 0) return;
    const next = (activeIndex() + delta + list.length) % list.length;
    setActiveIndex(next);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(-1);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      openItem(activeItem() ?? undefined);
    }
  };

  createEffect(() => {
    const maxIndex = resultItems().length - 1;
    if (maxIndex < 0) {
      setActiveIndex(0);
      return;
    }

    if (activeIndex() > maxIndex) setActiveIndex(maxIndex);
  });

  createEffect(() => {
    const item = activeItem();
    const key = item ? rowKey(item) : null;

    setPreviewFailed(false);
    if (!key) return;

    queueMicrotask(() => {
      rowRefs.get(key)?.scrollIntoView({ block: "nearest" });
    });
  });

  createEffect(() => {
    const input = parsedInput();

    setRequestError(null);
    if (!canSearch()) {
      cancelDebounce();
      searchMutation.abort();
      setResultItems([]);
      setActiveIndex(0);
      return;
    }

    debounceSearch(input);
  });

  onCleanup(() => {
    cancelDebounce();
    searchMutation.abort();
  });

  onMount(() => {
    requestAnimationFrame(() => inputRef?.focus());
  });

  return (
    <div
      class="flex h-full min-h-0 flex-col text-zinc-900 dark:text-zinc-100 [--spotlight-body-max:calc(50vh-5.5rem)] [@media(min-height:1100px)]:[--spotlight-body-max:calc(33vh-5.5rem)]"
      onWheel={(event) => event.stopPropagation()}
    >
      <label class="flex items-center gap-3 px-4 py-3.5">
        <i class="ti ti-search text-xl text-dimmed" />
        <input
          id="spotlight-input"
          ref={inputRef}
          type="search"
          value={rawInput()}
          onInput={(event) => setRawInput(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search across apps..."
          aria-label="Global search"
          class="w-full border-0 bg-transparent text-base outline-none placeholder:text-dimmed md:text-lg"
          spellcheck={false}
          autocapitalize="off"
          autocomplete="off"
          autocorrect="off"
        />
        <Show when={searchMutation.loading()}>
          <i class="ti ti-loader-2 animate-spin text-dimmed" />
        </Show>
      </label>

      <div
        class="overflow-hidden transition-[height,opacity] duration-200 ease-out"
        style={{
          height: shouldShowList() ? "var(--spotlight-body-max)" : "0px",
          opacity: shouldShowList() ? "1" : "0",
        }}
      >
        <div class="flex h-full min-h-0 flex-col gap-2 px-3 pb-3">
          <div class="flex h-8 items-center justify-between gap-3">
            <div class="flex min-w-0 items-center gap-2 text-[11px] text-dimmed">
              <Show when={parsedInput().tags.length > 0}>
                <div class="flex items-center gap-1">
                  <For each={parsedInput().tags}>
                    {(tag) => <span class="rounded bg-zinc-200/70 px-1.5 py-0.5 text-[10px] dark:bg-zinc-800/70">#{tag}</span>}
                  </For>
                </div>
              </Show>
              <span>
                {resultItems().length} results found{" "}
                <span aria-hidden="true">•</span>{" "}
                <button type="button" class="text-blue-500 hover:underline dark:text-blue-400" onClick={openHelp}>
                  improve with tags
                </button>
              </span>
            </div>
          </div>

          <div class="min-h-0 flex-1 overflow-hidden">
            <Show when={requestError()}>{(message) => <div class="info-block-danger mb-2 text-xs">{message()}</div>}</Show>

            <div class="grid h-full min-h-0 grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_18rem]">
              <section class="min-h-0 overflow-y-auto overscroll-y-contain pr-1" onWheel={(event) => event.stopPropagation()}>
                <div class="flex flex-col gap-1.5">
                  <For each={resultItems()}>
                    {(row, index) => {
                      const selected = () => index() === activeIndex();
                      const item = row;
                      return (
                        <button
                          ref={(element) => bindRowRef(rowKey(item), element)}
                          type="button"
                          onMouseEnter={() => setActiveIndex(index())}
                          onClick={() => openItem(item)}
                          class="w-full rounded-xl p-2.5 text-left transition-colors"
                          classList={{
                            "bg-blue-50/85 dark:bg-blue-950/45": selected(),
                            "bg-zinc-50/75 hover:bg-zinc-100/85 dark:bg-zinc-900/45 dark:hover:bg-zinc-900/65": !selected(),
                          }}
                        >
                          <div class="flex items-start gap-2.5">
                            <i class={`${item.icon ?? item.appIcon} mt-0.5 text-[13px] text-dimmed`} />
                            <div class="min-w-0">
                              <p class="truncate text-xs">{item.title}</p>
                              <Show when={item.preview}>
                                <p class="mt-0.5 truncate text-[11px] text-dimmed">{item.preview}</p>
                              </Show>
                              <p class="mt-1 text-[10px] text-dimmed">{item.appName}</p>
                            </div>
                          </div>
                        </button>
                      );
                    }}
                  </For>
                </div>
              </section>

              <aside
                class="hidden min-h-0 overflow-y-auto overscroll-y-contain rounded-xl bg-zinc-50/80 p-3 dark:bg-zinc-900/55 md:block"
                onWheel={(event) => event.stopPropagation()}
              >
                <Show when={activeItem()} fallback={<div class="text-xs text-dimmed">Select a result to preview details.</div>}>
                  {(item) => (
                    <div class="flex flex-col gap-4">
                      <div class="flex items-center gap-3">
                        <div class="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-900">
                          <Show
                            when={isValidImagePreviewUrl(item().previewUrl) && !previewFailed()}
                            fallback={<i class={`${item().icon ?? item().appIcon} text-lg text-dimmed`} />}
                          >
                            <img
                              src={item().previewUrl}
                              alt={item().title}
                              class="h-full w-full object-cover"
                              onError={() => setPreviewFailed(true)}
                            />
                          </Show>
                        </div>
                        <div class="min-w-0">
                          <p class="truncate text-sm">{item().title}</p>
                          <p class="mt-0.5 truncate text-xs text-dimmed">{item().appName}</p>
                        </div>
                      </div>

                      <Show when={item().preview}>
                        <p class="text-xs leading-relaxed text-dimmed">{item().preview}</p>
                      </Show>

                      <Show when={metadataRows(item().metadata).length > 0}>
                        <div class="rounded-lg bg-zinc-100/65 p-2 dark:bg-zinc-900/65">
                          <div class="divide-y divide-zinc-200/80 dark:divide-zinc-800/80">
                          <For each={metadataRows(item().metadata)}>
                            {(entry) => (
                              <div class="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-2 py-1.5 text-xs first:pt-0 last:pb-0">
                                <span class="truncate text-dimmed">{entry.label}</span>
                                <span class="truncate">{entry.value}</span>
                              </div>
                            )}
                          </For>
                          </div>
                        </div>
                      </Show>
                    </div>
                  )}
                </Show>
              </aside>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export const openGlobalSearchDialog = (helpApps: GlobalSearchHelpApp[] = []) => {
  if (dialogCore.isOpen()) return;

  void dialogCore.open<void>((close) => <GlobalSearchDialog close={close} helpApps={helpApps} />, {
    panelClassName:
      "fixed left-1/2 top-[25vh] -translate-x-1/2 m-0 w-[min(96vw,72rem)] max-h-[50vh] overflow-hidden overscroll-y-contain rounded-2xl border-0 bg-white/92 p-0 text-zinc-900 shadow-xl ring-1 ring-inset ring-zinc-300/60 backdrop:bg-black/35 backdrop:backdrop-blur-sm dark:bg-zinc-950/92 dark:text-zinc-100 dark:ring-zinc-700/60 [@media(min-height:1100px)]:top-[33vh] [@media(min-height:1100px)]:max-h-[33vh]",
    contentClassName: "h-full min-h-0",
    initialFocus: "none",
  });
};
