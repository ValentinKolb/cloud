import { type AiInterChatMessage, aiConversations, aiProjects, deliverAiInterChatMessage } from "@valentinkolb/cloud/ai";
import { accounts, logger } from "@valentinkolb/cloud/services";
import { assistantChatPrompt } from "./prompt";

const ASSISTANT_APP_ID = "assistant";
const modelPolicy = { kind: "selectable" as const, requiredCapabilities: ["streaming" as const] };
const log = logger("assistant:inter-chat-messages");

export type AssistantMessageDeliveryStatus = "queued" | "delivered" | "failed";

export const deliverPendingAssistantMessages = async (
  targetConversationId?: string,
): Promise<Map<string, AssistantMessageDeliveryStatus>> => {
  const outcomes = new Map<string, AssistantMessageDeliveryStatus>();
  let pending: AiInterChatMessage[];
  try {
    pending = await aiConversations.listPendingInterChatMessages({ targetConversationId, limit: 50 });
  } catch (error) {
    log.warn("Could not load pending inter-chat messages", { error: error instanceof Error ? error.message : String(error) });
    return outcomes;
  }
  for (const message of pending) {
    try {
      const [user, activeTarget] = await Promise.all([
        accounts.users.get({ id: message.actorUserId }),
        aiConversations.getConversation({
          conversationId: message.targetConversationId,
          appId: ASSISTANT_APP_ID,
          ownerUserId: message.actorUserId,
        }),
      ]);
      if (!user) {
        await aiConversations.failInterChatMessage({ messageId: message.id, error: "Message actor is unavailable" });
        outcomes.set(message.id, "failed");
        continue;
      }
      const target =
        activeTarget ??
        (await aiConversations.getConversationByShortId({
          shortId: message.targetChatId,
          appId: ASSISTANT_APP_ID,
          ownerUserId: message.actorUserId,
          archived: true,
        }));
      if (!target) continue;
      const project = target.projectId
        ? await aiProjects.snapshot(target.projectId, ASSISTANT_APP_ID, { type: "user", userId: user.id })
        : null;
      if (target.projectId && !project) {
        await aiConversations.failInterChatMessage({ messageId: message.id, error: "Target Project is unavailable" });
        outcomes.set(message.id, "failed");
        continue;
      }
      const delivered = await deliverAiInterChatMessage({
        message,
        actor: { kind: "user", user },
        modelPolicy,
        systemPrompt: assistantChatPrompt(target.shortId),
        project: project ?? undefined,
        sourceHref: `/app/assistant?conversation=${encodeURIComponent(message.sourceChatId)}`,
        toolSource: { kind: "default", capabilities: true },
        toolApprovalContext: { actorUserId: user.id, appId: ASSISTANT_APP_ID, resource: { kind: "direct" } },
      });
      outcomes.set(message.id, delivered.delivered ? "delivered" : delivered.reason === "busy" ? "queued" : "failed");
    } catch (error) {
      outcomes.set(message.id, "queued");
      log.warn("Inter-chat message delivery failed; leaving it pending", {
        messageId: message.shortId,
        targetChatId: message.targetChatId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return outcomes;
};
