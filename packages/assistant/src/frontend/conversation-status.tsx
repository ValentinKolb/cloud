import type { AiConversation } from "@valentinkolb/cloud/ai";
import { Show } from "solid-js";
import { conversationStatusPresentation } from "./conversation-view";

export function ConversationStatusMeta(props: { conversation: AiConversation; labels?: boolean; hideStatus?: boolean }) {
  const status = () => (props.hideStatus ? null : conversationStatusPresentation(props.conversation));
  return (
    <span class="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-dimmed">
      <Show when={props.conversation.pinnedAt}>
        <span class="inline-flex items-center gap-1" title="Pinned">
          <i class="ti ti-pin-filled text-xs" aria-hidden="true" />
          <Show when={props.labels}>Pinned</Show>
          <Show when={!props.labels}><span class="sr-only">Pinned</span></Show>
        </span>
      </Show>
      <Show when={status()}>
        {(item) => (
          <span class={`inline-flex items-center gap-1 ${item().class}`} title={item().label}>
            <i class={`${item().icon} text-xs`} aria-hidden="true" />
            <Show when={props.labels}>{item().label}</Show>
            <Show when={!props.labels}><span class="sr-only">{item().label}</span></Show>
          </span>
        )}
      </Show>
    </span>
  );
}
