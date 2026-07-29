import type { ChatTimelineItem } from "@k2b/ui";
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  Show,
  type JSX,
} from "solid-js";
import type { AiActiveTurn } from "../client/projection";
import {
  type AiActiveTurnSegment,
  isRenderableTurnBlock,
  splitActiveTurnBlocks,
} from "../protocol";
import {
  type AiAssistantTimelineItem,
  buildAiMessageTimeline,
  copyTextFromAssistantEntries,
} from "../timeline";
import type { AiConversationTimelineEntry, AiStoredMessage } from "../types";
import { AiTurnBlockList } from "./blocks";
import {
  AiChatActionsProvider,
  type AiChatActions,
  AssistantMessageActions,
} from "./message-actions";
import {
  formatWorkedDuration,
  isCardToolName,
  isSurveyToolName,
  textFromMessage,
} from "./message-utils";
import { ChatUtilityDisclosure, PulseDots } from "./primitives";
import { TurnNavigator } from "./turn-navigator";
import { activeTimelineSeq } from "./turn-navigator-utils";
import {
  AiSteerMessageActions,
  AiSteerMessageContent,
  AiUserMessageActions,
  AiUserMessageContent,
} from "./user-message";

export type AiChatTimelineSession = {
  messages: readonly AiStoredMessage[];
  activeTurn: AiActiveTurn | null;
};

export { AiChatActionsProvider, type AiChatActions };

const isShowcaseBlock = (block: AiAssistantTimelineItem["blocks"][number]) =>
  block.kind === "tool" &&
  (isCardToolName(block.name) ||
    isSurveyToolName(block.name) ||
    block.name === "present");

function AiAssistantContent(props: { item: AiAssistantTimelineItem }): JSX.Element {
  const renderable = createMemo(() =>
    props.item.blocks.filter(isRenderableTurnBlock),
  );
  const worked = () =>
    renderable().filter(
      (block) => block.kind !== "text" && !isShowcaseBlock(block),
    );
  const visible = () =>
    renderable().filter(
      (block) => block.kind === "text" || isShowcaseBlock(block),
    );
  const turnId = () => props.item.loopId ?? props.item.id;

  return (
    <div class="flex flex-col gap-2">
      <Show when={worked().length > 0}>
        <ChatUtilityDisclosure
          meta={{
            icon: "ti ti-route",
            label: `Worked for ${formatWorkedDuration(props.item.workedMs)}`,
          }}
        >
          <AiTurnBlockList blocks={worked()} turnId={turnId()} compact />
        </ChatUtilityDisclosure>
      </Show>
      <AiTurnBlockList blocks={visible()} turnId={turnId()} />
    </div>
  );
}

const storedItems = (messages: readonly AiStoredMessage[]): ChatTimelineItem[] =>
  buildAiMessageTimeline([...messages]).map((item): ChatTimelineItem => {
    if (item.type === "user") {
      return {
        kind: "message",
        id: item.id,
        role: "user",
        createdAt: item.entry.createdAt,
        content: <AiUserMessageContent entry={item.entry} />,
        actions: <AiUserMessageActions entry={item.entry} />,
      };
    }

    if (item.type === "summary") {
      const count = item.entry.meta?.compactedCount;
      const date = new Date(item.entry.createdAt).toLocaleDateString();
      return {
        kind: "activity",
        id: item.id,
        label: "Context compacted",
        description: count
          ? `${count} message${count === 1 ? "" : "s"} summarized · ${date}`
          : date,
        icon: "ti ti-brain",
        tone: "ai",
        content: (
          <div data-ai-turn-seq={item.entry.seq}>
            <p class="mb-1 text-[10px] font-medium uppercase tracking-wide text-dimmed">
              The model now sees this summary instead of the messages above
            </p>
            <p class="whitespace-pre-wrap">
              {textFromMessage(item.entry.message) || "No visible content"}
            </p>
          </div>
        ),
      };
    }

    const actionEntry = item.actionEntry?.compactedAt
      ? null
      : item.actionEntry;
    const copyText = copyTextFromAssistantEntries(item.entries);
    return {
      kind: "message",
      id: item.id,
      role: "assistant",
      createdAt: actionEntry?.createdAt ?? item.entries.at(-1)?.createdAt,
      content: (
        <div data-ai-turn-seq={actionEntry?.seq ?? item.entries.at(-1)?.seq}>
          <AiAssistantContent item={item} />
        </div>
      ),
      actions: actionEntry ? (
        <AssistantMessageActions
          entry={actionEntry}
          entries={item.entries}
          copyText={copyText}
        />
      ) : undefined,
    };
  });

const activeItems = (turn: AiActiveTurn | null): ChatTimelineItem[] => {
  if (!turn) return [];
  const segments = splitActiveTurnBlocks(turn.blocks);
  if (segments.length === 0) {
    return [
      {
        kind: "activity",
        id: `${turn.turnId}-pending`,
        label: "Generating response",
        icon: "ti ti-sparkles",
        tone: "ai",
        trailing: <PulseDots />,
      },
    ];
  }

  return segments.map((segment, index): ChatTimelineItem => {
    if (segment.type === "steer") {
      const block = (
        segment as Extract<AiActiveTurnSegment, { type: "steer" }>
      ).block;
      return {
        kind: "message",
        id: `${turn.turnId}-steer-${block.id}`,
        role: "user",
        status:
          block.status === "pending"
            ? "pending"
            : block.status === "failed"
              ? "error"
              : "complete",
        content: (
          <div data-ai-turn-seq={turn.seq}>
            <AiSteerMessageContent block={block} />
          </div>
        ),
        actions: <AiSteerMessageActions block={block} />,
      };
    }

    const blocks = (
      segment as Extract<AiActiveTurnSegment, { type: "assistant" }>
    ).blocks;
    return {
      kind: "message",
      id: `${turn.turnId}-assistant-${index}`,
      role: "assistant",
      status:
        turn.status === "running" && index === segments.length - 1
          ? "streaming"
          : "complete",
      content: (
        <div data-ai-turn-seq={turn.seq}>
          <AiTurnBlockList
            blocks={blocks}
            turnId={turn.turnId}
            streaming={
              turn.status === "running" && index === segments.length - 1
            }
          />
        </div>
      ),
    };
  });
};

const aiChatTimelineItems = (
  session: AiChatTimelineSession,
): ChatTimelineItem[] => [
  ...storedItems(session.messages),
  ...activeItems(session.activeTurn),
];

export type AiChatProjectionProps = AiChatTimelineSession & {
  render: (items: Accessor<readonly ChatTimelineItem[]>) => JSX.Element;
};

/**
 * Keeps Cloud's rich renderers below the action provider while exposing only
 * the portable timeline items to the host application's @k2b/ui surface.
 */
export function AiChatProjection(props: AiChatProjectionProps): JSX.Element {
  const items = createMemo(() =>
    aiChatTimelineItems({
      messages: props.messages,
      activeTurn: props.activeTurn,
    }),
  );
  return props.render(items);
}

export type AiChatTurnNavigatorProps = {
  entries: readonly AiConversationTimelineEntry[];
  loading?: boolean;
  viewport: () => HTMLDivElement | undefined;
  content: () => HTMLDivElement | undefined;
  loadThrough: (seq: number) => Promise<boolean>;
};

export function AiChatTurnNavigator(
  props: AiChatTurnNavigatorProps,
): JSX.Element {
  const [activeSeq, setActiveSeq] = createSignal<number | null>(null);
  const [loadingSeq, setLoadingSeq] = createSignal<number | null>(null);
  const [height, setHeight] = createSignal(0);
  let navigationRevision = 0;

  const update = () => {
    const viewport = props.viewport();
    const content = props.content();
    if (!viewport || !content || props.entries.length === 0) {
      setActiveSeq(null);
      return;
    }
    setHeight(viewport.clientHeight);
    if (
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 8
    ) {
      setActiveSeq(props.entries.at(-1)?.seq ?? null);
      return;
    }
    const anchors = Array.from(
      content.querySelectorAll<HTMLElement>("[data-ai-turn-seq]"),
    ).flatMap((node) => {
      const seq = Number(node.dataset.aiTurnSeq);
      return Number.isFinite(seq)
        ? [{ seq, top: node.getBoundingClientRect().top }]
        : [];
    });
    const rect = viewport.getBoundingClientRect();
    setActiveSeq(activeTimelineSeq(anchors, rect.top, rect.height));
  };

  createEffect(() => {
    const viewport = props.viewport();
    const content = props.content();
    if (!viewport || !content) return;
    update();
    viewport.addEventListener("scroll", update, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(update);
    observer?.observe(viewport);
    observer?.observe(content);
    onCleanup(() => {
      viewport.removeEventListener("scroll", update);
      observer?.disconnect();
    });
  });

  const select = async (entry: AiConversationTimelineEntry) => {
    const revision = ++navigationRevision;
    const content = props.content();
    let anchor =
      content?.querySelector<HTMLElement>(
        `[data-ai-turn-seq="${entry.seq}"]`,
      ) ?? null;
    if (!anchor) {
      setLoadingSeq(entry.seq);
      const loaded = await props.loadThrough(entry.seq);
      if (!loaded || revision !== navigationRevision) {
        setLoadingSeq(null);
        return;
      }
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      anchor =
        props
          .content()
          ?.querySelector<HTMLElement>(
            `[data-ai-turn-seq="${entry.seq}"]`,
          ) ?? null;
    }
    const viewport = props.viewport();
    if (!viewport || !anchor || revision !== navigationRevision) return;
    const viewportRect = viewport.getBoundingClientRect();
    viewport.scrollTop = Math.max(
      0,
      viewport.scrollTop +
        anchor.getBoundingClientRect().top -
        viewportRect.top -
        16,
    );
    setActiveSeq(entry.seq);
    setLoadingSeq(null);
  };

  return (
    <Show
      when={props.entries.length >= 5 && height() > 0 && !props.loading}
    >
      <div class="ai-turn-navigator-shell pointer-events-none relative h-0">
        <div
          class="absolute top-0"
          style={{ left: "max(0.5rem, calc(50% - 30rem))" }}
        >
          <TurnNavigator
            entries={[...props.entries]}
            activeSeq={activeSeq()}
            loadingSeq={loadingSeq()}
            height={Math.max(120, height() - 16)}
            onSelect={(entry) => void select(entry)}
          />
        </div>
      </div>
    </Show>
  );
}
