import type { AiPublicModelProfile } from "@valentinkolb/cloud/ai";
import { createAiChatController } from "@valentinkolb/cloud/ai/solid";
import {
  AiChatActionsProvider,
  AiChatProjection,
  aiChatModelOptions,
  aiComposerSendInput,
} from "@valentinkolb/cloud/ai/ui";
import { ChatComposer, ChatContextUsage, ChatTimeline } from "@k2b/ui";
import { createSignal } from "solid-js";

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
  const [draft, setDraft] = createSignal("");

  return (
    <div class="k2b-ui">
      <AiChatActionsProvider
        actions={{
          onApproval: async (request, input) => {
            await chat.respondToApproval(request, input);
          },
          onFrontendToolResult: async (request, result) => {
            await chat.submitFrontendToolResult(request, result);
          },
          fileUrl: chat.fileContentUrl,
        }}
      >
        <AiChatProjection
          messages={chat.messages()}
          activeTurn={chat.activeTurn()}
          render={(items) => (
            <ChatTimeline
              items={items()}
              loading={chat.loadingConversation()}
              hasMore={chat.hasMoreHistory()}
              loadingOlder={chat.loadingOlder()}
              onLoadOlder={chat.loadOlderMessages}
            />
          )}
        />
      </AiChatActionsProvider>

      <ChatComposer
        value={draft()}
        onValueChange={setDraft}
        models={aiChatModelOptions(props.models)}
        selectedModelId={props.selectedModelId()}
        onModelChange={props.selectModel}
        running={chat.running()}
        stopping={chat.runStatus() === "stopping"}
        onSend={(input) =>
          chat.send({
            ...aiComposerSendInput(input),
            modelProfileId: props.selectedModelId(),
          })
        }
        onSteer={chat.steer}
        onStop={async () => {
          await chat.abort();
        }}
        context={<ChatContextUsage contextWindow={128_000} />}
      />
    </div>
  );
}
