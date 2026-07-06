import type { AiConversation } from "@valentinkolb/cloud/ai";
import { dialogCore, IconInput, PanelDialog, panelDialogOptions, prompts, TextInput, toast } from "@valentinkolb/cloud/ui";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createSignal } from "solid-js";
import { apiClient } from "../api/client";

type EditConversationResult = { action: "save"; conversation: AiConversation } | { action: "delete"; conversation: AiConversation };

type EditConversationFormProps = {
  conversation: AiConversation;
  close: (result?: EditConversationResult) => void;
};

const DEFAULT_CHAT_ICON = "ti ti-message";

const readErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  const body = (await response.json().catch(() => null)) as { message?: string; error?: { message?: string } } | null;
  return body?.message ?? body?.error?.message ?? fallback;
};

export const conversationIcon = (conversation: AiConversation): string => conversation.icon?.trim() || DEFAULT_CHAT_ICON;

function EditConversationForm(props: EditConversationFormProps) {
  const [title, setTitle] = createSignal(props.conversation.title);
  const [icon, setIcon] = createSignal(conversationIcon(props.conversation));
  const [description, setDescription] = createSignal(props.conversation.description);

  const save = mutation.create<AiConversation, void>({
    mutation: async () => {
      const response = await apiClient.conversations[":conversationId"].$patch({
        param: { conversationId: props.conversation.id },
        json: {
          title: title().trim(),
          icon: icon().trim() || DEFAULT_CHAT_ICON,
          description: description().trim(),
        },
      });
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to save chat"));
      return (await response.json()) as AiConversation;
    },
    onSuccess: (conversation) => {
      toast.success("Chat saved");
      props.close({ action: "save", conversation });
    },
    onError: (error) => prompts.error(error.message),
  });

  const remove = mutation.create<boolean, void>({
    mutation: async () => {
      const confirmed = await prompts.confirm(`Delete "${props.conversation.title}"?`, {
        title: "Delete chat",
        icon: "ti ti-trash",
        variant: "danger",
        confirmText: "Delete",
        cancelText: "Cancel",
      });
      if (!confirmed) return false;

      const response = await apiClient.conversations[":conversationId"].$delete({
        param: { conversationId: props.conversation.id },
      });
      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to delete chat"));
      return true;
    },
    onSuccess: (deleted) => {
      if (!deleted) return;
      toast.success("Chat deleted");
      props.close({ action: "delete", conversation: props.conversation });
    },
    onError: (error) => prompts.error(error.message),
  });

  return (
    <PanelDialog>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save.mutate(undefined);
        }}
      >
        <PanelDialog.Header title="Edit chat" icon="ti ti-settings" close={() => props.close()} />
        <PanelDialog.Body>
          <IconInput label="Icon" value={icon} onChange={setIcon} required clearable={false} />
          <TextInput label="Name" value={title} onInput={setTitle} required maxLength={120} />
          <TextInput
            label="Description"
            value={description}
            onInput={setDescription}
            multiline
            lines={3}
            maxLength={500}
            placeholder="Optional context for this chat..."
          />
        </PanelDialog.Body>
        <PanelDialog.Footer>
          <button type="button" class="btn-danger btn-sm" disabled={remove.loading() || save.loading()} onClick={() => remove.mutate(undefined)}>
            <i class={remove.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-trash"} />
            Delete
          </button>
          <div class="flex items-center gap-2">
            <button type="button" class="btn-secondary btn-sm" disabled={save.loading() || remove.loading()} onClick={() => props.close()}>
              Cancel
            </button>
            <button type="submit" class="btn-primary btn-sm" disabled={save.loading() || remove.loading() || !title().trim()}>
              <i class={save.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-device-floppy"} />
              Save
            </button>
          </div>
        </PanelDialog.Footer>
      </form>
    </PanelDialog>
  );
}

export const openAssistantConversationEditor = (conversation: AiConversation): Promise<EditConversationResult | undefined> =>
  dialogCore.open<EditConversationResult | undefined>((close) => <EditConversationForm conversation={conversation} close={close} />, panelDialogOptions);
