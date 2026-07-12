import { clipboard, mutation } from "@valentinkolb/stdlib/solid";
import { createSignal, For, Show } from "solid-js";
import { DialogHeader, Dropdown, type DropdownItem, dialogCore, TextInput } from "../../ui";
import type { AiTurnBlock } from "../protocol";
import type { AiStoredMessage, AiUserContentPart } from "../types";
import { useAiMessageActions } from "./message-actions";
import {
  type AiRetryMessageInput,
  copyTextFromMessage,
  filePartsFromMessage,
  formatBytes,
  imageSrc,
  textAttachmentSummariesFromMessage,
  userContentWithEditedVisibleText,
  userVisibleTextFromMessage,
  vfsAttachmentsFromMessage,
} from "./message-utils";

const openModifyRetryDialog = (
  entry: AiStoredMessage,
  onRetryMessage: (entry: AiStoredMessage, input?: AiRetryMessageInput) => void | Promise<void>,
) => {
  void dialogCore.open<void>(
    (close) => {
      const [draft, setDraft] = createSignal(userVisibleTextFromMessage(entry.message));
      const content = () => userContentWithEditedVisibleText(entry.message, draft());
      const retryMutation = mutation.create<void, AiUserContentPart[]>({
        mutation: async (nextContent) => onRetryMessage(entry, { content: nextContent }),
        onSuccess: () => close(),
      });
      const canRetry = () => content().length > 0 && !retryMutation.loading();
      const retry = () => {
        const nextContent = content();
        if (nextContent.length === 0 || retryMutation.loading()) return;
        void retryMutation.mutate(nextContent);
      };

      return (
        <div class="flex min-w-[min(92vw,34rem)] flex-col gap-4">
          <DialogHeader title="Edit and try again" icon="ti ti-pencil" close={() => close()} />
          <div class="px-4">
            <TextInput
              label="Prompt"
              description="Attachments from the original message stay attached."
              multiline
              lines={8}
              value={draft}
              onInput={setDraft}
              onSubmit={retry}
            />
          </div>
          <div class="flex justify-end gap-2 px-4 pb-4">
            <button type="button" class="btn-input btn-input-sm" onClick={() => close()}>
              Cancel
            </button>
            <button type="button" class="btn-ai btn-sm" disabled={!canRetry()} onClick={retry}>
              <i class={`ti ${retryMutation.loading() ? "ti-loader-2 animate-spin" : "ti-refresh"}`} aria-hidden="true" />
              {retryMutation.loading() ? "Trying again" : "Try again"}
            </button>
          </div>
          <Show when={retryMutation.error()}>
            <p class="px-4 pb-4 text-xs text-red-600 dark:text-red-400">Could not retry this message. Your changes are still here.</p>
          </Show>
        </div>
      );
    },
    {
      panelClassName:
        "fixed left-1/2 top-1/2 m-0 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-none backdrop:bg-black/45 backdrop:backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:backdrop:bg-black/35",
      contentClassName: "p-0",
    },
  );
};

export function UserMessageBubble(props: { entry: AiStoredMessage }) {
  const actions = useAiMessageActions();
  const message = () => props.entry.message;
  const text = () => userVisibleTextFromMessage(message());
  const images = () => filePartsFromMessage(message()).filter((part) => part.mediaType.startsWith("image/"));
  const textAttachments = () => textAttachmentSummariesFromMessage(message());
  const vfsAttachments = () => vfsAttachmentsFromMessage(message());
  const copyText = () => copyTextFromMessage(message());
  const { copy, wasCopied } = clipboard.create(1400);
  const retry = mutation.create<void, AiRetryMessageInput | undefined>({
    mutation: async (input) => {
      if (!actions.onRetryMessage) throw new Error("Retry is unavailable.");
      await actions.onRetryMessage(props.entry, input);
    },
  });
  const submitRetry = (input?: AiRetryMessageInput) => {
    if (!retry.loading()) void retry.mutate(input);
  };
  const retryMenuItems = (): DropdownItem[] => [
    {
      sectionLabel: "Try again",
      items: [
        {
          icon: "ti ti-refresh",
          label: "Try again",
          action: () => submitRetry({ mode: "retry" }),
        },
        {
          icon: "ti ti-list-details",
          label: "More detailed",
          action: () => submitRetry({ mode: "details" }),
        },
        {
          icon: "ti ti-align-left",
          label: "More concise",
          action: () => submitRetry({ mode: "concise" }),
        },
      ],
    },
    {
      sectionLabel: "Edit",
      items: [
        {
          icon: "ti ti-pencil",
          label: "Edit prompt",
          action: () => {
            if (actions.onRetryMessage) openModifyRetryDialog(props.entry, actions.onRetryMessage);
          },
        },
      ],
    },
  ];

  return (
    <div class="group flex justify-end px-3 py-2" data-ai-turn-seq={props.entry.seq}>
      <div class="flex max-w-[min(44rem,88%)] flex-col items-end gap-2">
        <Show when={images().length > 0 || textAttachments().length > 0 || vfsAttachments().length > 0}>
          <div class="flex flex-wrap justify-end gap-2">
            <For each={images()}>
              {(part) => (
                <img
                  src={imageSrc(part)}
                  alt="Uploaded image"
                  class="max-h-56 max-w-72 rounded-md border border-zinc-200 object-contain dark:border-zinc-800"
                />
              )}
            </For>
            <For each={textAttachments()}>
              {(attachment) => (
                <div
                  class="grid h-14 w-14 place-items-center rounded-md border border-zinc-200 bg-zinc-100 px-1 text-center dark:border-zinc-800 dark:bg-zinc-900"
                  title={`${attachment.name}${attachment.size ? `, ${attachment.size}` : ""}`}
                >
                  <div class="min-w-0">
                    <i class={`ti ${attachment.icon} text-lg`} aria-hidden="true" />
                    <p class="mt-0.5 w-12 truncate text-[10px] leading-3 text-dimmed">{attachment.name}</p>
                  </div>
                </div>
              )}
            </For>
            <For each={vfsAttachments()}>
              {(attachment) => (
                <div
                  class="grid h-14 w-14 place-items-center rounded-md border border-zinc-200 bg-zinc-100 px-1 text-center dark:border-zinc-800 dark:bg-zinc-900"
                  title={`${attachment.path}, ${formatBytes(attachment.size)}`}
                >
                  <div class="min-w-0">
                    <i class={`ti ${attachment.icon} text-lg`} aria-hidden="true" />
                    <p class="mt-0.5 w-12 truncate text-[10px] leading-3 text-dimmed">{attachment.name}</p>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
        <Show when={text()}>
          <div class="paper rounded-br-sm px-3 py-2 text-sm leading-6 text-primary">
            <p class="whitespace-pre-wrap">{text()}</p>
          </div>
        </Show>
        <div class="flex items-center gap-0.5 text-dimmed opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:focus-within:opacity-100">
          <Show when={copyText()}>
            <button
              type="button"
              class="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-zinc-100 hover:text-primary dark:hover:bg-zinc-900"
              aria-label="Copy user message"
              title="Copy"
              onClick={() => void copy(copyText())}
            >
              <i class={`ti ${wasCopied() ? "ti-check" : "ti-copy"} text-sm`} aria-hidden="true" />
            </button>
          </Show>
          {/* Compacted messages left the model context — retrying them would rewrite history the model no longer shares. */}
          <Show when={!props.entry.compactedAt ? actions.onRetryMessage : undefined}>
            <Show
              when={!retry.loading()}
              fallback={
                <span class="inline-flex h-7 w-7 items-center justify-center" title="Trying again">
                  <i class="ti ti-loader-2 animate-spin text-sm" aria-hidden="true" />
                  <span class="sr-only">Trying again</span>
                </span>
              }
            >
              <Dropdown
                position="bottom-left"
                width="w-56"
                elements={retryMenuItems()}
                trigger={
                  <span
                    class="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-zinc-100 hover:text-primary dark:hover:bg-zinc-900"
                    title="Message actions"
                  >
                    <i class="ti ti-dots text-sm" aria-hidden="true" />
                    <span class="sr-only">Message actions</span>
                  </span>
                }
              />
            </Show>
          </Show>
        </div>
        <Show when={retry.error()}>
          <button
            type="button"
            class="inline-flex items-center gap-1 text-[10px] font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            onClick={() => void retry.retry()}
          >
            <i class="ti ti-refresh text-xs" aria-hidden="true" />
            Retry failed. Try again
          </button>
        </Show>
      </div>
    </div>
  );
}

export function SteerMessageBubble(props: { block: Extract<AiTurnBlock, { kind: "steer_message" }> }) {
  const actions = useAiMessageActions();
  return (
    <div class="flex justify-end px-3 py-2">
      <div class="flex max-w-[min(44rem,88%)] flex-col items-end gap-1">
        <div class="paper rounded-br-sm px-3 py-2 text-sm leading-6 text-primary">
          <p class="whitespace-pre-wrap">{props.block.text}</p>
        </div>
        <Show when={props.block.status === "pending"}>
          <span class="inline-flex items-center gap-1 text-[10px] text-dimmed">
            <i class="ti ti-clock text-xs" aria-hidden="true" />
            Pending
          </span>
        </Show>
        <Show when={props.block.status === "failed"}>
          <button
            type="button"
            class="inline-flex items-center gap-1 text-[10px] font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            onClick={() => void actions.onRetrySteer?.(props.block)}
          >
            <i class="ti ti-refresh text-xs" aria-hidden="true" />
            Retry
          </button>
        </Show>
      </div>
    </div>
  );
}
