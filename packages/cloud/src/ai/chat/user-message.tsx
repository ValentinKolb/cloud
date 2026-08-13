import { mutation } from "@k2b/stdlib/solid";
import { Button, type ChatAction, type ChatAttachment, dialogCore, PanelDialog, panelDialogOptions, TextInput } from "@k2b/ui";
import { createSignal, Show } from "solid-js";
import type { AiTurnBlock } from "../protocol";
import type { AiStoredMessage, AiUserContentPart } from "../types";
import type { AiChatActions } from "./message-actions";
import {
  type AiRetryMessageInput,
  copyTextFromMessage,
  textAttachmentSummariesFromMessage,
  userContentWithEditedVisibleText,
  userVisibleTextFromMessage,
  vfsAttachmentsFromMessage,
} from "./message-utils";

const openModifyRetryDialog = (
  entry: AiStoredMessage,
  onRetryMessage: (entry: AiStoredMessage, input?: AiRetryMessageInput) => void | Promise<void>,
) => {
  void dialogCore.open<void>((close) => {
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
      <PanelDialog>
        <PanelDialog.Header title="Edit and try again" icon="ti ti-pencil" close={close} />
        <PanelDialog.Body>
          <TextInput
            label="Prompt"
            description="Attachments from the original message stay attached."
            multiline
            lines={8}
            value={draft}
            onValueChange={setDraft}
            onSubmit={retry}
          />
          <Show when={retryMutation.error()}>
            <p class="text-xs text-red-600 dark:text-red-400" role="alert">
              Could not retry this message. Your changes are still here.
            </p>
          </Show>
        </PanelDialog.Body>
        <PanelDialog.Footer>
          <div class="ml-auto flex items-center gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => close()}>
              Cancel
            </Button>
            <Button type="button" variant="ai" size="sm" disabled={!canRetry()} onClick={retry}>
              <i class={`ti ${retryMutation.loading() ? "ti-loader-2 animate-spin" : "ti-refresh"}`} aria-hidden="true" />
              {retryMutation.loading() ? "Trying again" : "Try again"}
            </Button>
          </div>
        </PanelDialog.Footer>
      </PanelDialog>
    );
  }, panelDialogOptions);
};

export const aiUserMessageText = (entry: AiStoredMessage): string => userVisibleTextFromMessage(entry.message);

export const aiUserMessageAttachments = (entry: AiStoredMessage, actions: AiChatActions = {}): ChatAttachment[] => [
  ...textAttachmentSummariesFromMessage(entry.message).map((attachment, index) => ({
    id: `${entry.id}-text-${index}`,
    name: attachment.name,
    kind: "file" as const,
    icon: `ti ${attachment.icon}`,
  })),
  ...vfsAttachmentsFromMessage(entry.message).map((attachment, index) => ({
    id: `${entry.id}-vfs-${index}`,
    name: attachment.name,
    size: attachment.size,
    kind: attachment.mediaType.startsWith("image/") ? ("image" as const) : ("file" as const),
    previewUrl: attachment.mediaType.startsWith("image/") ? (actions.fileUrl?.(attachment.path) ?? undefined) : undefined,
    icon: attachment.mediaType.startsWith("image/") ? "ti ti-photo" : `ti ${attachment.icon}`,
  })),
];

export const createAiUserMessageActions = (entry: AiStoredMessage, actions: AiChatActions): ChatAction[] => {
  const result: ChatAction[] = [];
  const copyText = copyTextFromMessage(entry.message);

  if (copyText) {
    result.push({ id: "copy", label: "Copy", icon: "ti ti-copy", copyText });
  }
  if (!entry.compactedAt && actions.onRetryMessage) {
    result.push(
      {
        id: "retry",
        label: "Try again",
        icon: "ti ti-refresh",
        onSelect: () => actions.onRetryMessage?.(entry, { mode: "retry" }),
      },
      {
        id: "details",
        label: "More detailed",
        icon: "ti ti-list-details",
        onSelect: () => actions.onRetryMessage?.(entry, { mode: "details" }),
      },
      {
        id: "concise",
        label: "More concise",
        icon: "ti ti-align-left",
        onSelect: () => actions.onRetryMessage?.(entry, { mode: "concise" }),
      },
      {
        id: "edit",
        label: "Edit prompt",
        icon: "ti ti-pencil",
        onSelect: () => openModifyRetryDialog(entry, actions.onRetryMessage!),
      },
    );
  }
  return result;
};

export const aiSteerMessageText = (block: Extract<AiTurnBlock, { kind: "steer_message" }>): string => block.text;

export const createAiSteerMessageActions = (
  block: Extract<AiTurnBlock, { kind: "steer_message" }>,
  actions: AiChatActions,
): ChatAction[] => {
  if (block.status !== "failed" || !actions.onRetrySteer) return [];
  return [
    {
      id: "retry-steer",
      label: "Retry guidance",
      icon: "ti ti-refresh",
      onSelect: () => actions.onRetrySteer?.(block),
    },
  ];
};
