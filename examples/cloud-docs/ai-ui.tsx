import type { AiPublicModelProfile } from "@valentinkolb/cloud/ai";
import { createAiChatController } from "@valentinkolb/cloud/ai/solid";
import { AiComposer, AiMessageList } from "@valentinkolb/cloud/ai/ui";

export function ItemChat(props: {
  itemId: string;
  models: AiPublicModelProfile[];
  selectedModelId: () => string;
  selectModel: (id: string) => void;
}) {
  const chat = createAiChatController({
    baseUrl: `/api/inventory/ai/items/${props.itemId}`,
    trackViewedState: true,
  });

  return (
    <>
      <AiMessageList
        session={{
          messages: chat.messages,
          activeTurn: chat.activeTurn,
          loading: chat.loadingConversation,
        }}
      />
      <AiComposer
        models={{
          profiles: () => props.models,
          selectedId: props.selectedModelId,
          onSelect: props.selectModel,
        }}
        state={{
          disabled: () => false,
          running: chat.running,
          canStop: () => Boolean(chat.activeTurn()),
          stopping: () => chat.runStatus() === "stopping",
        }}
        actions={{
          send: chat.send,
          steer: chat.steer,
          stop: chat.abort,
        }}
      />
    </>
  );
}
