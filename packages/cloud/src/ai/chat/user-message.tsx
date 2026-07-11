import { clipboard } from "@valentinkolb/stdlib/solid";
import { createSignal, For, Show } from "solid-js";
import { DialogHeader, Dropdown, type DropdownItem, dialogCore, TextInput } from "../../ui";
import type { AiStoredMessage } from "../types";
import { useAiMessageActions } from "./message-actions";
import {
  copyTextFromMessage,
  filePartsFromMessage,
  formatBytes,
  imageSrc,
  textAttachmentSummariesFromMessage,
  type AiRetryMessageInput,
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
      const canRetry = () => content().length > 0;
      const retry = () => {
        const nextContent = content();
        if (nextContent.length === 0) return;
        close();
        void onRetryMessage(entry, { content: nextContent });
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
              Try again
            </button>
          </div>
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
  const retryMenuItems = (
    onRetryMessage: (entry: AiStoredMessage, input?: AiRetryMessageInput) => void | Promise<void>,
  ): DropdownItem[] => [
    {
      sectionLabel: "Try again",
      items: [
        {
          icon: "ti ti-refresh",
          label: "Try again",
          action: () => void onRetryMessage(props.entry, { mode: "retry" }),
        },
        {
          icon: "ti ti-list-details",
          label: "More detailed",
          action: () => void onRetryMessage(props.entry, { mode: "details" }),
        },
        {
          icon: "ti ti-align-left",
          label: "More concise",
          action: () => void onRetryMessage(props.entry, { mode: "concise" }),
        },
      ],
    },
    {
      sectionLabel: "Edit",
      items: [
        {
          icon: "ti ti-pencil",
          label: "Edit prompt",
          action: () => openModifyRetryDialog(props.entry, onRetryMessage),
        },
      ],
    },
  ];

  return (
    <div class="group flex justify-end px-3 py-2">
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
        <div class="flex items-center gap-0.5 text-dimmed opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
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
            {(onRetryMessage) => (
              <Dropdown
                position="bottom-left"
                width="w-56"
                elements={retryMenuItems(onRetryMessage())}
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
            )}
          </Show>
        </div>
      </div>
    </div>
  );
}
