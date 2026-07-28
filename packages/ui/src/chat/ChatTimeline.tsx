import {
  createEffect,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import Placeholder from "../surfaces/Placeholder";
import { isChatNearBottom, restoredChatScrollTop } from "./chat-behavior";
import {
  ChatActivity,
  type ChatActivityTone,
  ChatMessage,
  type ChatMessageStatus,
  type ChatRole,
} from "./ChatPrimitives";

export type ChatMessageItem = {
  kind: "message";
  id: string;
  role: ChatRole;
  content: JSX.Element;
  label?: string;
  createdAt?: string | Date;
  timeLabel?: string;
  status?: ChatMessageStatus;
  actions?: JSX.Element;
  class?: string;
};

export type ChatActivityItem = {
  kind: "activity";
  id: string;
  label: string;
  description?: string;
  icon?: string;
  tone?: ChatActivityTone;
  trailing?: JSX.Element;
  defaultOpen?: boolean;
  content?: JSX.Element;
  class?: string;
};

export type ChatTimelineItem = ChatMessageItem | ChatActivityItem;

export type ChatTimelineProps = {
  items: readonly ChatTimelineItem[];
  conversationKey?: string | null;
  loading?: boolean;
  hasMore?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => boolean | void | Promise<boolean | void>;
  emptyTitle?: JSX.Element;
  emptyDescription?: JSX.Element;
  label?: string;
  followThreshold?: number;
  class?: string;
};

export function ChatTimeline(props: ChatTimelineProps): JSX.Element {
  const [pinned, setPinned] = createSignal(true);
  const [loadingOlderInternally, setLoadingOlderInternally] = createSignal(false);
  const [historyError, setHistoryError] = createSignal<string | null>(null);
  let viewportRef: HTMLDivElement | undefined;
  let contentRef: HTMLDivElement | undefined;
  let topSentinelRef: HTMLDivElement | undefined;
  let followFrame: number | undefined;
  let lastConversationKey: string | null | undefined;

  const loadingOlder = () => Boolean(props.loadingOlder || loadingOlderInternally());
  const hasContent = () => props.items.length > 0;
  const threshold = () => Math.max(0, props.followThreshold ?? 96);

  const cancelFollow = () => {
    if (followFrame !== undefined) cancelAnimationFrame(followFrame);
    followFrame = undefined;
  };

  const scrollToLatest = () => {
    if (!viewportRef) return;
    setPinned(true);
    viewportRef.scrollTop = viewportRef.scrollHeight;
  };

  const scheduleFollow = () => {
    if (!pinned() || followFrame !== undefined) return;
    followFrame = requestAnimationFrame(() => {
      followFrame = undefined;
      if (pinned()) scrollToLatest();
    });
  };

  const loadOlder = async () => {
    if (!props.onLoadOlder || !props.hasMore || loadingOlder()) return;
    const viewport = viewportRef;
    if (!viewport) return;
    const previousScrollTop = viewport.scrollTop;
    const previousScrollHeight = viewport.scrollHeight;
    setHistoryError(null);
    setLoadingOlderInternally(true);
    let prepended = false;
    try {
      prepended = (await props.onLoadOlder()) !== false;
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : "Could not load older messages");
    } finally {
      setLoadingOlderInternally(false);
    }
    if (!prepended || viewportRef !== viewport) return;
    queueMicrotask(() => {
      requestAnimationFrame(() => {
        if (viewportRef !== viewport) return;
        viewport.scrollTop = restoredChatScrollTop(
          previousScrollTop,
          previousScrollHeight,
          viewport.scrollHeight,
        );
      });
    });
  };

  const updatePinned = () => {
    if (!viewportRef) return;
    setPinned(
      isChatNearBottom(
        viewportRef.scrollHeight,
        viewportRef.scrollTop,
        viewportRef.clientHeight,
        threshold(),
      ),
    );
    if (viewportRef.scrollTop <= threshold()) void loadOlder();
  };

  onMount(() => {
    scrollToLatest();
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => scheduleFollow());
    if (contentRef) resizeObserver?.observe(contentRef);

    const historyObserver =
      typeof IntersectionObserver === "undefined" || !topSentinelRef
        ? null
        : new IntersectionObserver(
            (entries) => {
              if (entries.some((entry) => entry.isIntersecting)) void loadOlder();
            },
            { root: viewportRef, rootMargin: "160px 0px 0px" },
          );
    if (topSentinelRef) historyObserver?.observe(topSentinelRef);

    onCleanup(() => {
      cancelFollow();
      resizeObserver?.disconnect();
      historyObserver?.disconnect();
    });
  });

  createEffect(() => {
    const key = props.conversationKey;
    if (key === lastConversationKey) return;
    lastConversationKey = key;
    setHistoryError(null);
    setPinned(true);
    queueMicrotask(scrollToLatest);
  });

  createEffect(() => {
    props.items.length;
    props.items.at(-1)?.id;
    scheduleFollow();
  });

  return (
    <section class={`k2b-chat-timeline ${props.class ?? ""}`} aria-label={props.label ?? "Conversation"}>
      <div
        ref={viewportRef}
        class="k2b-chat-timeline__viewport"
        onScroll={updatePinned}
      >
        <div
          ref={contentRef}
          class="k2b-chat-timeline__content"
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          aria-busy={props.loading ? "true" : undefined}
        >
          <div ref={topSentinelRef} class="k2b-chat-timeline__sentinel" aria-hidden="true" />
          <Show when={loadingOlder()}>
            <ChatActivity
              label="Loading older messages"
              icon="ti ti-history"
              trailing={<i class="ti ti-loader-2 k2b-spin" aria-hidden="true" />}
            />
          </Show>
          <Show when={historyError()}>
            {(message) => (
              <ChatActivity
                label="Could not load older messages"
                description={message()}
                icon="ti ti-alert-circle"
                tone="danger"
                trailing={
                  <button
                    type="button"
                    class="k2b-chat-timeline__retry"
                    aria-label="Retry loading older messages"
                    onClick={() => void loadOlder()}
                  >
                    <i class="ti ti-refresh" aria-hidden="true" />
                  </button>
                }
              />
            )}
          </Show>
          <Show
            when={!props.loading && hasContent()}
            fallback={
              <Placeholder
                class="k2b-chat-timeline__placeholder"
                state={props.loading ? "loading" : "empty"}
                icon={props.loading ? undefined : "ti ti-sparkles"}
                title={props.loading ? "Loading conversation" : (props.emptyTitle ?? "Start a conversation")}
                description={!props.loading ? props.emptyDescription : undefined}
              />
            }
          >
            <For each={props.items}>
              {(item) => (
                <Show
                  when={item.kind === "message"}
                  fallback={
                    <ChatActivity
                      label={(item as ChatActivityItem).label}
                      description={(item as ChatActivityItem).description}
                      icon={(item as ChatActivityItem).icon}
                      tone={(item as ChatActivityItem).tone}
                      trailing={(item as ChatActivityItem).trailing}
                      defaultOpen={(item as ChatActivityItem).defaultOpen}
                      class={(item as ChatActivityItem).class}
                    >
                      {(item as ChatActivityItem).content}
                    </ChatActivity>
                  }
                >
                  <ChatMessage
                    role={(item as ChatMessageItem).role}
                    content={(item as ChatMessageItem).content}
                    label={(item as ChatMessageItem).label}
                    createdAt={(item as ChatMessageItem).createdAt}
                    timeLabel={(item as ChatMessageItem).timeLabel}
                    status={(item as ChatMessageItem).status}
                    actions={(item as ChatMessageItem).actions}
                    class={(item as ChatMessageItem).class}
                  />
                </Show>
              )}
            </For>
          </Show>
        </div>
      </div>
      <Show when={!pinned() && hasContent()}>
        <button
          type="button"
          class="k2b-chat-timeline__latest"
          onClick={scrollToLatest}
        >
          <i class="ti ti-arrow-down" aria-hidden="true" />
          Jump to latest
        </button>
      </Show>
    </section>
  );
}
