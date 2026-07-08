import { createEffect, createMemo, For, Show } from "solid-js";
import { Placeholder } from "../../ui";
import type { AiActiveTurn } from "../client/projection";
import {
  type AiAssistantTimelineItem,
  type AiMessageTimelineItem,
  buildAiMessageTimeline,
  copyTextFromAssistantEntries,
} from "../timeline";
import type { AiStoredMessage } from "../types";
import { AiTurnBlockList } from "./blocks";
import { AiMessageActionsProvider, type AiMessageListActions, AssistantMessageActions } from "./message-actions";
import { textFromMessage } from "./message-utils";
import { AssistantMessageLane, ChatUtilityLine, PulseDots } from "./primitives";
import { UserMessageBubble } from "./user-message";

export type { AiMessageListActions };

export type AiMessageListSession = {
  messages: () => AiStoredMessage[];
  activeTurn: () => AiActiveTurn | null;
};

function SummaryRow(props: { entry: AiStoredMessage }) {
  const text = () => textFromMessage(props.entry.message);
  return (
    <div class="px-3 py-1.5">
      <div class="inline-flex max-w-[min(46rem,100%)] items-start gap-2 rounded-md bg-zinc-100/70 px-2.5 py-1.5 text-xs text-secondary dark:bg-zinc-900/70">
        <i class="ti ti-info-circle mt-0.5 text-sm text-dimmed" aria-hidden="true" />
        <div class="min-w-0">
          <p class="font-medium text-primary">Summary</p>
          <Show when={text()} fallback={<p class="text-dimmed">No visible content</p>}>
            <p class="mt-0.5 whitespace-pre-wrap">{text()}</p>
          </Show>
        </div>
      </div>
    </div>
  );
}

function AssistantResponseGroup(props: { item: AiAssistantTimelineItem }) {
  const copyText = () => copyTextFromAssistantEntries(props.item.entries);
  return (
    <AssistantMessageLane
      actions={
        <Show when={props.item.actionEntry}>
          {(entry) => <AssistantMessageActions entry={entry()} entries={props.item.entries} copyText={copyText()} />}
        </Show>
      }
    >
      <AiTurnBlockList blocks={props.item.blocks} turnId={props.item.loopId ?? props.item.id} />
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
  const timelineItems = createMemo(() => buildAiMessageTimeline(props.session.messages()));
  const activeTurn = () => props.session.activeTurn();
  const activeBlocks = () => activeTurn()?.blocks ?? [];
  const streaming = () => activeTurn()?.status === "running";

  createEffect(() => {
    timelineItems().length;
    activeBlocks().length;
    // Track the last block's text length so streaming deltas keep the view pinned.
    const last = activeBlocks().at(-1);
    if (last && (last.kind === "text" || last.kind === "thinking")) last.text.length;
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
          </div>
        </Show>
      </div>
    </AiMessageActionsProvider>
  );
}
