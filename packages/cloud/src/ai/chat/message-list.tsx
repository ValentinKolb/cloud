import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Placeholder } from "../../ui";
import type { AiActiveTurn } from "../client/projection";
import { isRenderableTurnBlock } from "../protocol";
import {
  type AiAssistantTimelineItem,
  type AiMessageTimelineItem,
  buildAiMessageTimeline,
  copyTextFromAssistantEntries,
} from "../timeline";
import type { AiStoredMessage } from "../types";
import { AiTurnBlockList } from "./blocks";
import { AiMessageActionsProvider, type AiMessageListActions, AssistantMessageActions } from "./message-actions";
import { formatWorkedDuration, isCardToolName, isSurveyToolName, textFromMessage } from "./message-utils";
import { AssistantMessageLane, ChatUtilityDisclosure, ChatUtilityLine, PulseDots } from "./primitives";
import { UserMessageBubble } from "./user-message";

export type { AiMessageListActions };

export type AiMessageListSession = {
  messages: () => AiStoredMessage[];
  activeTurn: () => AiActiveTurn | null;
  /** Infinite scroll: older history exists above the loaded window. */
  history?: {
    hasMore: () => boolean;
    loading: () => boolean;
    /** Load one older page; resolves after the messages were prepended. */
    loadOlder: () => Promise<boolean>;
  };
};

/** Distance from the bottom (px) within which the view auto-follows new content. */
const AUTO_FOLLOW_THRESHOLD_PX = 96;

/** The nearest ancestor that actually scrolls — the message list does not own its scroll container. */
const findScrollParent = (node: HTMLElement | null): HTMLElement | null => {
  let current = node?.parentElement ?? null;
  while (current) {
    const style = getComputedStyle(current);
    if ((style.overflowY === "auto" || style.overflowY === "scroll") && current.scrollHeight > current.clientHeight) return current;
    current = current.parentElement;
  }
  return null;
};

/**
 * Compaction marker: everything above was archived out of the model context and
 * replaced by this summary. The messages stay visible for the reader; the model
 * only sees the summary. Same look as the live "Compacting context" row.
 */
function SummaryRow(props: { entry: AiStoredMessage }) {
  const text = () => textFromMessage(props.entry.message);
  const description = () => {
    const count = props.entry.meta?.compactedCount;
    const date = new Date(props.entry.createdAt).toLocaleDateString();
    return count ? `${count} message${count === 1 ? "" : "s"} summarized · ${date}` : date;
  };
  return (
    <div class="px-3 py-1">
      <ChatUtilityDisclosure meta={{ icon: "ti ti-brain", label: "Context compacted", description: description(), tone: "ai" }}>
        <div class="max-w-xl rounded-md bg-zinc-100/70 p-2 text-[11px] leading-5 text-secondary dark:bg-zinc-950/70">
          <p class="mb-1 text-[10px] font-medium uppercase tracking-wide text-dimmed">
            The model now sees this summary instead of the messages above
          </p>
          <p class="whitespace-pre-wrap">{text() || "No visible content"}</p>
        </div>
      </ChatUtilityDisclosure>
    </div>
  );
}

function AssistantResponseGroup(props: { item: AiAssistantTimelineItem }) {
  const copyText = () => copyTextFromAssistantEntries(props.item.entries);
  // Archived (compacted) responses stay readable but lose retry/fork actions.
  const actionEntry = () => (props.item.actionEntry?.compactedAt ? null : props.item.actionEntry);

  // Finished loops fold their WORKING steps away — thinking, compaction, and
  // utility tools (bash, web_search, memory, …) — into one "Worked for Xs"
  // row. Everything the user is meant to READ stays visible in its original
  // interleaved order: every text block plus tools whose whole point is their
  // rendered output (cards, surveys, presented files). Models often write a
  // sentence, drop a card, then continue — the leading prose must never get
  // swallowed by the collapse. Watching live stays unchanged — the active
  // turn renders through its own component.
  const isShowcaseBlock = (block: (typeof props.item.blocks)[number]) =>
    block.kind === "tool" && (isCardToolName(block.name) || isSurveyToolName(block.name) || block.name === "present");
  const renderableBlocks = createMemo(() => props.item.blocks.filter(isRenderableTurnBlock));
  const workedBlocks = () => renderableBlocks().filter((block) => block.kind !== "text" && !isShowcaseBlock(block));
  const visibleBlocks = () => renderableBlocks().filter((block) => block.kind === "text" || isShowcaseBlock(block));
  const turnId = () => props.item.loopId ?? props.item.id;

  return (
    <AssistantMessageLane
      actions={
        <Show when={actionEntry()}>
          {(entry) => <AssistantMessageActions entry={entry()} entries={props.item.entries} copyText={copyText()} />}
        </Show>
      }
    >
      <Show when={workedBlocks().length > 0}>
        <ChatUtilityDisclosure meta={{ icon: "ti ti-route", label: `Worked for ${formatWorkedDuration(props.item.workedMs)}` }}>
          <div class="flex flex-col gap-1">
            <AiTurnBlockList blocks={workedBlocks()} turnId={turnId()} />
          </div>
        </ChatUtilityDisclosure>
      </Show>
      <AiTurnBlockList blocks={visibleBlocks()} turnId={turnId()} />
    </AssistantMessageLane>
  );
}

function TimelineItemView(props: { item: AiMessageTimelineItem }) {
  if (props.item.type === "user") return <UserMessageBubble entry={props.item.entry} />;
  if (props.item.type === "summary") return <SummaryRow entry={props.item.entry} />;
  return <AssistantResponseGroup item={props.item} />;
}

/**
 * One render stack: persisted messages become assistant/user/summary timeline
 * items, and the active turn renders as one more assistant group with the same
 * block components. Because the active turn's persisted rounds are hidden by the
 * projection and its blocks carry stable ids, the live-to-persisted hand-off at
 * turn_finished is a single reconciled swap with no reparenting or duplication.
 */
export function AiMessageList(props: { session: AiMessageListSession; actions?: AiMessageListActions; emptyTitle?: string }) {
  let endRef: HTMLDivElement | undefined;
  let topSentinelRef: HTMLDivElement | undefined;
  let scrollParent: HTMLElement | null = null;

  const timelineItems = createMemo(() => buildAiMessageTimeline(props.session.messages()));
  const activeTurn = () => props.session.activeTurn();
  const activeBlocks = () => activeTurn()?.blocks ?? [];
  const streaming = () => activeTurn()?.status === "running";
  const history = () => props.session.history;

  // Follow mode: the view only sticks to the bottom while the reader is there.
  // Scrolling up detaches it — streaming deltas must never yank the reader down.
  const [pinned, setPinned] = createSignal(true);

  const updatePinned = () => {
    if (!scrollParent) return;
    const distance = scrollParent.scrollHeight - scrollParent.scrollTop - scrollParent.clientHeight;
    setPinned(distance < AUTO_FOLLOW_THRESHOLD_PX);
  };

  const jumpToLatest = () => {
    setPinned(true);
    endRef?.scrollIntoView({ block: "end", behavior: "smooth" });
  };

  /** Load one older page and keep the reader's position stable while content grows above. */
  const maybeLoadOlder = async () => {
    const pager = history();
    if (!pager || !scrollParent || pager.loading() || !pager.hasMore()) return;
    const parent = scrollParent;
    const prevHeight = parent.scrollHeight;
    const prevTop = parent.scrollTop;
    const prepended = await pager.loadOlder();
    if (!prepended) return;
    requestAnimationFrame(() => {
      parent.scrollTop = parent.scrollHeight - prevHeight + prevTop;
      // Short pages may leave the sentinel visible without a new intersection
      // transition — keep loading until it is out of view or history ends.
      if (topSentinelRef && parent) {
        const rect = topSentinelRef.getBoundingClientRect();
        const rootRect = parent.getBoundingClientRect();
        if (rect.bottom >= rootRect.top - 200) void maybeLoadOlder();
      }
    });
  };

  onMount(() => {
    scrollParent = findScrollParent(endRef ?? null);
    if (scrollParent) {
      scrollParent.addEventListener("scroll", updatePinned, { passive: true });
      onCleanup(() => scrollParent?.removeEventListener("scroll", updatePinned));
      updatePinned();
    }
    if (topSentinelRef) {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) void maybeLoadOlder();
        },
        { root: scrollParent, rootMargin: "200px 0px 0px 0px" },
      );
      observer.observe(topSentinelRef);
      onCleanup(() => observer.disconnect());
    }
  });

  // Opening/switching a chat always starts at the latest message.
  let lastConversationKey: string | null = null;
  createEffect(() => {
    const conversationKey = props.session.messages()[0]?.conversationId ?? "";
    if (conversationKey !== lastConversationKey) {
      lastConversationKey = conversationKey;
      setPinned(true);
    }
  });

  // Sending a message or a starting turn re-attaches the view to the bottom.
  let lastFollowKey = "";
  createEffect(() => {
    const last = timelineItems().at(-1);
    const followKey = `${last?.type === "user" ? last.id : ""}|${activeTurn()?.turnId ?? ""}`;
    if (followKey === lastFollowKey) return;
    const shouldFollow = last?.type === "user" || Boolean(activeTurn());
    lastFollowKey = followKey;
    if (shouldFollow) setPinned(true);
  });

  createEffect(() => {
    timelineItems().length;
    activeBlocks().length;
    // Track the last block's text length so streaming deltas keep the view pinned.
    const last = activeBlocks().at(-1);
    if (last && (last.kind === "text" || last.kind === "thinking")) last.text.length;
    if (!pinned()) return;
    queueMicrotask(() => endRef?.scrollIntoView({ block: "end" }));
  });

  const hasContent = () => props.session.messages().length > 0 || Boolean(activeTurn());

  return (
    <AiMessageActionsProvider actions={props.actions}>
      <div class="min-h-full px-2 py-4 sm:px-4">
        <Show
          when={hasContent()}
          fallback={
            <div class="flex min-h-full items-center justify-center p-4">
              <Placeholder surface="none" icon="ti ti-sparkles">
                {props.emptyTitle ?? "Start a conversation"}
              </Placeholder>
            </div>
          }
        >
          <div class="mx-auto flex max-w-4xl flex-col gap-1">
            <div ref={topSentinelRef} aria-hidden="true" />
            <Show when={history()?.loading()}>
              <ChatUtilityLine meta={{ icon: "ti ti-history", label: "Loading older messages" }} trailing={<PulseDots />} />
            </Show>
            <For each={timelineItems()}>{(item) => <TimelineItemView item={item} />}</For>
            <Show when={activeTurn()}>
              {(turn) => (
                <AssistantMessageLane>
                  <Show
                    when={activeBlocks().length > 0}
                    fallback={<ChatUtilityLine meta={{ icon: "ti ti-sparkles", label: "Thinking", tone: "ai" }} trailing={<PulseDots />} />}
                  >
                    <AiTurnBlockList blocks={turn().blocks} turnId={turn().turnId} streaming={streaming()} />
                  </Show>
                </AssistantMessageLane>
              )}
            </Show>
            <div ref={endRef} />
            <Show when={!pinned()}>
              <div class="pointer-events-none sticky bottom-3 z-10 flex justify-center">
                <button type="button" class="btn-input btn-input-sm pointer-events-auto" onClick={jumpToLatest}>
                  <i class="ti ti-arrow-down" aria-hidden="true" />
                  Jump to latest
                </button>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </AiMessageActionsProvider>
  );
}
