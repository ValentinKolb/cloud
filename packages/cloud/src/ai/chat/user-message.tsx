import { clipboard, mutation } from "@k2b/stdlib/solid";
import { Button, DialogHeader, Dropdown, type DropdownItem, dialogCore, IconButton, TextInput } from "@k2b/ui";
import { createSignal, For, Show } from "solid-js";
import type { AiTurnBlock } from "../protocol";
import type { AiStoredMessage, AiUserContentPart } from "../types";
import { useAiChatActions } from "./message-actions";
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
        <div class="flex w-[min(var(--ui-dialog-available-width),34rem)] flex-col gap-4">
          <DialogHeader title="Edit and try again" icon="ti ti-pencil" close={() => close()} />
          <div class="px-4">
            <TextInput
              label="Prompt"
              description="Attachments from the original message stay attached."
              multiline
              lines={8}
              value={draft}
              onValueChange={setDraft}
              onSubmit={retry}
            />
          </div>
          <div class="flex justify-end gap-2 px-4 pb-4">
            <Button type="button" variant="secondary" size="sm" onClick={() => close()}>
              Cancel
            </Button>
            <Button type="button" variant="ai" size="sm" disabled={!canRetry()} onClick={retry}>
              <i class={`ti ${retryMutation.loading() ? "ti-loader-2 animate-spin" : "ti-refresh"}`} aria-hidden="true" />
              {retryMutation.loading() ? "Trying again" : "Try again"}
            </Button>
          </div>
          <Show when={retryMutation.error()}>
            <p class="px-4 pb-4 text-xs text-red-600 dark:text-red-400">Could not retry this message. Your changes are still here.</p>
          </Show>
        </div>
      );
    },
    {
      panelClassName:
        "fixed left-1/2 top-1/2 m-0 max-h-[var(--ui-dialog-available-height)] max-w-[var(--ui-dialog-available-width)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-none backdrop:bg-black/45 backdrop:backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:backdrop:bg-black/35",
      contentClassName: "dialog-viewport-content p-0",
    },
  );
};

export function AiUserMessageContent(props: { entry: AiStoredMessage }) {
  const message = () => props.entry.message;
  const text = () => userVisibleTextFromMessage(message());
  const images = () => filePartsFromMessage(message()).filter((part) => part.mediaType.startsWith("image/"));
  const textAttachments = () => textAttachmentSummariesFromMessage(message());
  const vfsAttachments = () => vfsAttachmentsFromMessage(message());

  return (
    <div data-ai-turn-seq={props.entry.seq}>
      <Show when={images().length > 0 || textAttachments().length > 0 || vfsAttachments().length > 0}>
        <div class="mb-2 flex flex-wrap justify-end gap-2">
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
      <Show when={text()}>{(value) => <p class="whitespace-pre-wrap">{value()}</p>}</Show>
    </div>
  );
}

export function AiUserMessageActions(props: { entry: AiStoredMessage }) {
  const actions = useAiChatActions();
  const message = () => props.entry.message;
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
    <>
      <Show when={copyText()}>
        <IconButton type="button" label="Copy user message" size="xs" onClick={() => void copy(copyText())}>
          <i class={`ti ${wasCopied() ? "ti-check" : "ti-copy"} text-sm`} aria-hidden="true" />
        </IconButton>
      </Show>
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
              <span title="Message actions">
                <i class="ti ti-dots text-sm" aria-hidden="true" />
                <span class="sr-only">Message actions</span>
              </span>
            }
          />
        </Show>
      </Show>
      <Show when={retry.error()}>
        <IconButton type="button" label="Retry failed. Try again" size="xs" onClick={() => void retry.retry()}>
          <i class="ti ti-refresh text-xs" aria-hidden="true" />
        </IconButton>
      </Show>
    </>
  );
}

export function AiSteerMessageContent(props: { block: Extract<AiTurnBlock, { kind: "steer_message" }> }) {
  return <p class="whitespace-pre-wrap">{props.block.text}</p>;
}

export function AiSteerMessageActions(props: { block: Extract<AiTurnBlock, { kind: "steer_message" }> }) {
  const actions = useAiChatActions();
  return (
    <Show when={props.block.status === "failed"}>
      <IconButton type="button" label="Retry steering message" size="xs" onClick={() => void actions.onRetrySteer?.(props.block)}>
        <i class="ti ti-refresh text-xs" aria-hidden="true" />
      </IconButton>
    </Show>
  );
}
