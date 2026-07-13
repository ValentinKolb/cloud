import { createEffect, createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { Placeholder } from "../../ui";
import type { AiActiveTurn } from "../client/projection";
import { type AiActiveTurnSegment, isRenderableTurnBlock, splitActiveTurnBlocks } from "../protocol";
import {
  type AiAssistantTimelineItem,
  type AiMessageTimelineItem,
  buildAiMessageTimeline,
  copyTextFromAssistantEntries,
} from "../timeline";
import type { AiConversationTimelineEntry, AiStoredMessage } from "../types";
import { AiTurnBlockList } from "./blocks";
import { AiMessageActionsProvider, type AiMessageListActions, AssistantMessageActions } from "./message-actions";
import {
  captureScrollSnapshot,
  isNearBottom,
  isScrollRestoreCurrent,
  keepBottomAligned,
  restoreAfterPrepend,
  scrollToBottom,
} from "./message-scroll";
import { formatWorkedDuration, isCardToolName, isSurveyToolName, textFromMessage } from "./message-utils";
import { AssistantMessageLane, ChatUtilityDisclosure, ChatUtilityLine, PulseDots } from "./primitives";
import { TurnNavigator } from "./turn-navigator";
import { activeTimelineSeq } from "./turn-navigator-utils";
import { SteerMessageBubble, UserMessageBubble } from "./user-message";

export type { AiMessageListActions };

export type AiMessageListSession = {
  conversationId?: () => string | null;
  messages: () => AiStoredMessage[];
  activeTurn: () => AiActiveTurn | null;
  loading?: () => boolean;
  /** Infinite scroll: older history exists above the loaded window. */
  history?: {
    hasMore: () => boolean;
    loading: () => boolean;
    /** Load one older page; resolves after the messages were prepended. */
    loadOlder: () => Promise<boolean>;
  };
  timeline?: {
    entries: () => AiConversationTimelineEntry[];
    loading: () => boolean;
    loadThrough: (seq: number) => Promise<boolean>;
  };
};

/** Distance from the bottom (px) within which the view auto-follows new content. */
const AUTO_FOLLOW_THRESHOLD_PX = 96;

const AI_PENDING_TURN_LABEL = "Generating response";

/** The nearest ancestor that actually scrolls — the message list does not own its scroll container. */
const findScrollParent = (node: HTMLElement | null): HTMLElement | null => {
  let current = node?.parentElement ?? null;
  while (current) {
    const style = getComputedStyle(current);
    if (style.overflowY === "auto" || style.overflowY === "scroll") return current;
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
          <AiTurnBlockList blocks={workedBlocks()} turnId={turnId()} compact />
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
  let contentRef: HTMLDivElement | undefined;
  let topSentinelRef: HTMLDivElement | undefined;
  let scrollParent: HTMLElement | null = null;
  let followFrame: number | undefined;
  let historyRestoreFrame: number | undefined;
  let timelineFrame: number | undefined;
  let scrollPhaseRevision = 0;
  let timelineNavigationRevision = 0;
  let preservingHistoryPosition = false;

  const timelineItems = createMemo(() => buildAiMessageTimeline(props.session.messages()));
  const activeTurn = () => props.session.activeTurn();
  const activeBlocks = () => activeTurn()?.blocks ?? [];
  const activeSegments = createMemo(() => splitActiveTurnBlocks(activeBlocks()));
  const streaming = () => activeTurn()?.status === "running";
  const history = () => props.session.history;
  const timeline = () => props.session.timeline;
  const timelineEntries = () => timeline()?.entries() ?? [];
  const loading = () => props.session.loading?.() ?? false;
  const hasContent = () => props.session.messages().length > 0 || Boolean(activeTurn());
  const conversationKey = () =>
    props.session.conversationId?.() ?? props.session.messages()[0]?.conversationId ?? activeTurn()?.turnId ?? "";

  // Follow mode: the view only sticks to the bottom while the reader is there.
  // Scrolling up detaches it — streaming deltas must never yank the reader down.
  const [pinned, setPinned] = createSignal(true);
  const [scrollReady, setScrollReady] = createSignal(false);
  const [historyError, setHistoryError] = createSignal<string | null>(null);
  const [viewportHeight, setViewportHeight] = createSignal(0);
  const [activeTimelineSeqValue, setActiveTimelineSeqValue] = createSignal<number | null>(null);
  const [loadingTimelineSeq, setLoadingTimelineSeq] = createSignal<number | null>(null);

  const findTimelineAnchor = (seq: number): HTMLElement | null =>
    contentRef?.querySelector<HTMLElement>(`[data-ai-turn-seq="${seq}"]`) ?? null;

  const updateActiveTimeline = () => {
    if (!scrollParent || !contentRef) return;
    const entries = timelineEntries();
    if (entries.length === 0) {
      setActiveTimelineSeqValue(null);
      return;
    }
    if (isNearBottom(scrollParent, 8)) {
      setActiveTimelineSeqValue(entries.at(-1)?.seq ?? null);
      return;
    }
    const anchors = Array.from(contentRef.querySelectorAll<HTMLElement>("[data-ai-turn-seq]")).flatMap((node) => {
      const seq = Number(node.dataset.aiTurnSeq);
      return Number.isFinite(seq) ? [{ seq, top: node.getBoundingClientRect().top }] : [];
    });
    const rect = scrollParent.getBoundingClientRect();
    setActiveTimelineSeqValue(activeTimelineSeq(anchors, rect.top, rect.height));
  };

  const scheduleTimelineUpdate = () => {
    if (timelineFrame !== undefined) return;
    timelineFrame = requestAnimationFrame(() => {
      timelineFrame = undefined;
      updateActiveTimeline();
    });
  };

  const updatePinned = () => {
    if (!scrollParent) return;
    setPinned(isNearBottom(scrollParent, AUTO_FOLLOW_THRESHOLD_PX));
    scheduleTimelineUpdate();
  };

  const alignToBottom = () => {
    if (!scrollParent) return;
    keepBottomAligned(scrollParent, { following: pinned(), preservingHistoryPosition });
  };

  const scheduleBottomAlignment = () => {
    if (followFrame !== undefined) return;
    followFrame = requestAnimationFrame(() => {
      followFrame = undefined;
      alignToBottom();
    });
  };

  const jumpToLatest = () => {
    setPinned(true);
    if (scrollParent) scrollToBottom(scrollParent);
  };

  const jumpToTimelineEntry = async (entry: AiConversationTimelineEntry) => {
    const revision = ++timelineNavigationRevision;
    setPinned(false);
    let anchor = findTimelineAnchor(entry.seq);
    if (!anchor) {
      setLoadingTimelineSeq(entry.seq);
      const loaded = await timeline()?.loadThrough(entry.seq);
      if (revision !== timelineNavigationRevision) return;
      if (!loaded) {
        setLoadingTimelineSeq(null);
        return;
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      anchor = findTimelineAnchor(entry.seq);
    }
    if (revision !== timelineNavigationRevision || !anchor || !scrollParent) return;
    const parentRect = scrollParent.getBoundingClientRect();
    const top = scrollParent.scrollTop + anchor.getBoundingClientRect().top - parentRect.top - 16;
    // A smooth scroll starts inside the bottom threshold and can re-enable
    // auto-follow before it moves away. Timeline markers are deliberate jumps.
    scrollParent.scrollTop = Math.max(0, top);
    setActiveTimelineSeqValue(entry.seq);
    setLoadingTimelineSeq(null);
  };

  const cancelHistoryRestore = () => {
    scrollPhaseRevision += 1;
    preservingHistoryPosition = false;
    if (historyRestoreFrame !== undefined) cancelAnimationFrame(historyRestoreFrame);
    historyRestoreFrame = undefined;
  };

  /** Load one older page and keep the reader's position stable while content grows above. */
  const maybeLoadOlder = async () => {
    const pager = history();
    if (!pager || !scrollParent || pager.loading() || !pager.hasMore()) return;
    const parent = scrollParent;
    const restoreToken = { conversationKey: conversationKey(), revision: scrollPhaseRevision };
    const snapshot = captureScrollSnapshot(parent);
    setHistoryError(null);
    preservingHistoryPosition = true;
    let prepended = false;
    try {
      prepended = await pager.loadOlder();
    } catch (error) {
      if (isScrollRestoreCurrent(restoreToken, conversationKey(), scrollPhaseRevision)) {
        setHistoryError(error instanceof Error ? error.message : "Could not load older messages");
      }
    } finally {
      if (!prepended && isScrollRestoreCurrent(restoreToken, conversationKey(), scrollPhaseRevision)) {
        preservingHistoryPosition = false;
      }
    }
    if (!prepended) return;
    if (!isScrollRestoreCurrent(restoreToken, conversationKey(), scrollPhaseRevision)) return;
    historyRestoreFrame = requestAnimationFrame(() => {
      historyRestoreFrame = undefined;
      if (!isScrollRestoreCurrent(restoreToken, conversationKey(), scrollPhaseRevision)) return;
      if (scrollParent !== parent) {
        preservingHistoryPosition = false;
        return;
      }
      restoreAfterPrepend(parent, snapshot);
      preservingHistoryPosition = false;
      updatePinned();
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
      setViewportHeight(scrollParent.clientHeight);
      setPinned(true);
      scrollToBottom(scrollParent);
      scrollParent.addEventListener("scroll", updatePinned, { passive: true });
      onCleanup(() => scrollParent?.removeEventListener("scroll", updatePinned));
      const resizeObserver = new ResizeObserver(() => {
        if (scrollParent) setViewportHeight(scrollParent.clientHeight);
        scheduleBottomAlignment();
        scheduleTimelineUpdate();
      });
      resizeObserver.observe(scrollParent);
      if (contentRef) resizeObserver.observe(contentRef);
      onCleanup(() => resizeObserver.disconnect());
    }
    setScrollReady(true);
    scheduleBottomAlignment();
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
    onCleanup(() => {
      if (followFrame !== undefined) cancelAnimationFrame(followFrame);
      if (timelineFrame !== undefined) cancelAnimationFrame(timelineFrame);
      cancelHistoryRestore();
    });
  });

  // Opening/switching a chat always starts at the latest message.
  let lastConversationPhase: string | null = null;
  createEffect(() => {
    const key = conversationKey();
    const phase = `${key}:${loading() ? "loading" : "ready"}`;
    if (phase === lastConversationPhase) return;
    lastConversationPhase = phase;
    timelineNavigationRevision += 1;
    setLoadingTimelineSeq(null);
    setActiveTimelineSeqValue(null);
    cancelHistoryRestore();
    setHistoryError(null);
    const phaseRevision = scrollPhaseRevision;
    setPinned(true);
    if (loading()) {
      setScrollReady(false);
      return;
    }
    if (!hasContent()) {
      setScrollReady(true);
      return;
    }
    setScrollReady(false);
    queueMicrotask(() => {
      if (!isScrollRestoreCurrent({ conversationKey: key, revision: phaseRevision }, conversationKey(), scrollPhaseRevision)) return;
      if (scrollParent) scrollToBottom(scrollParent);
      setScrollReady(true);
      scheduleBottomAlignment();
    });
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
    timelineEntries().length;
    activeBlocks().length;
    // Track the last block's text length so streaming deltas keep the view pinned.
    const last = activeBlocks().at(-1);
    if (last && (last.kind === "text" || last.kind === "thinking")) last.text.length;
    if (!pinned()) return;
    scheduleBottomAlignment();
    scheduleTimelineUpdate();
  });

  return (
    <AiMessageActionsProvider actions={props.actions}>
      <div
        ref={contentRef}
        class="ai-message-list-container relative min-h-full px-2 py-4 sm:px-4"
        classList={{ invisible: hasContent() && !scrollReady() }}
      >
        <Show when={timelineEntries().length >= 5 && viewportHeight() > 0 && !loading()}>
          <div class="ai-turn-navigator-shell pointer-events-none sticky top-0 z-20 h-0">
            <div class="absolute top-0" style={{ right: "calc(50% + 30rem)" }}>
              <TurnNavigator
                entries={timelineEntries()}
                activeSeq={activeTimelineSeqValue()}
                loadingSeq={loadingTimelineSeq()}
                height={Math.max(120, viewportHeight() - 16)}
                onSelect={(entry) => void jumpToTimelineEntry(entry)}
              />
            </div>
          </div>
        </Show>
        <Show
          when={hasContent()}
          fallback={
            <div class="flex min-h-full items-center justify-center p-4">
              <Placeholder surface="none" icon={loading() ? "ti ti-loader-2 animate-spin" : "ti ti-sparkles"}>
                {loading() ? "Loading conversation" : (props.emptyTitle ?? "Start a conversation")}
              </Placeholder>
            </div>
          }
        >
          <div class="mx-auto flex max-w-4xl flex-col gap-1">
            <div ref={topSentinelRef} aria-hidden="true" />
            <Show when={history()?.loading()}>
              <ChatUtilityLine meta={{ icon: "ti ti-history", label: "Loading older messages" }} trailing={<PulseDots />} />
            </Show>
            <Show when={historyError()}>
              {(message) => (
                <ChatUtilityLine
                  meta={{ icon: "ti ti-alert-circle", label: "Could not load older messages", description: message(), tone: "danger" }}
                  trailing={
                    <button
                      type="button"
                      class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md hover:bg-red-100/70 focus-ui dark:hover:bg-red-950/50"
                      title="Retry"
                      aria-label="Retry loading older messages"
                      onClick={() => void maybeLoadOlder()}
                    >
                      <i class="ti ti-refresh text-sm" aria-hidden="true" />
                    </button>
                  }
                />
              )}
            </Show>
            <For each={timelineItems()}>{(item) => <TimelineItemView item={item} />}</For>
            <Show when={activeTurn()}>
              {(turn) => (
                <Show
                  when={activeSegments().length > 0}
                  fallback={
                    <AssistantMessageLane>
                      <ChatUtilityLine
                        meta={{ icon: "ti ti-sparkles", label: AI_PENDING_TURN_LABEL, tone: "ai" }}
                        trailing={<PulseDots />}
                      />
                    </AssistantMessageLane>
                  }
                >
                  <For each={activeSegments()}>
                    {(segment, index) => (
                      <Switch>
                        <Match when={segment.type === "steer"}>
                          <SteerMessageBubble block={(segment as Extract<AiActiveTurnSegment, { type: "steer" }>).block} />
                        </Match>
                        <Match when={segment.type === "assistant"}>
                          <AssistantMessageLane>
                            <AiTurnBlockList
                              blocks={(segment as Extract<AiActiveTurnSegment, { type: "assistant" }>).blocks}
                              turnId={turn().turnId}
                              streaming={streaming() && index() === activeSegments().length - 1}
                            />
                          </AssistantMessageLane>
                        </Match>
                      </Switch>
                    )}
                  </For>
                </Show>
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
