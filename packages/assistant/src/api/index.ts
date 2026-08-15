import { createAiChatRoutes } from "@valentinkolb/cloud/ai";
import { type AuthContext, auth, err, fail, ok, type RequestActor, rateLimit, respond } from "@valentinkolb/cloud/server";
import type { Context } from "hono";
import { Hono } from "hono";
import { loadAssistantChatContextSnapshot } from "../chat-context";
import { chatTaskRoutes } from "../chat-tasks-routes";
import { loadAssistantProjectContextSnapshot } from "../project-context";
import { assistantModelPolicy } from "../model-policy";
import { assistantChatPrompt } from "../prompt";
import { loadAssistantSidebarSnapshot } from "../sidebar";

const ASSISTANT_APP_ID = "assistant";

const actorUser = (c: Context<AuthContext>) => {
  const actor = c.get("actor");
  return actor.kind === "user" ? actor.user : actor.delegatedUser;
};

const retryInstruction = (mode: "retry" | "details" | "concise"): string | null => {
  if (mode === "details") return "Answer the user's request again with more detail and specificity.";
  if (mode === "concise") return "Answer the user's request again more concisely.";
  return null;
};

const chatRoutes = createAiChatRoutes({
  appId: ASSISTANT_APP_ID,
  allowConversationManagement: true,
  conversationSystemPrompt: (conversation) => `Current Assistant chat ID: ${conversation.shortId}.`,
  retryInstruction,
  resolveContext: async (c: Context<AuthContext>) => {
    const actor = c.get("actor") as RequestActor;
    const user = actorUser(c);
    if (!user) return respond(c, fail(err.forbidden("Assistant requires a user-backed actor")));
    return {
      actor,
      ownerUserId: user.id,
      systemPrompt: assistantChatPrompt(),
      toolSource: { kind: "default", capabilities: true },
      modelPolicy: assistantModelPolicy,
      toolApprovalContext: { actorUserId: user.id, appId: ASSISTANT_APP_ID, resource: { kind: "direct" } },
    };
  },
});

const app = new Hono<AuthContext>()
  .use(rateLimit())
  .use("*", auth.requireRole("authenticated"))
  .use("*", auth.requireUser())
  .get("/workspace/sidebar", async (c) => {
    const user = actorUser(c);
    if (!user) return respond(c, fail(err.forbidden("Assistant requires a user-backed actor")));
    return respond(c, ok(await loadAssistantSidebarSnapshot(user.id)));
  })
  .get("/workspace/conversations/:conversationId/context", async (c) => {
    const user = actorUser(c);
    if (!user) return respond(c, fail(err.forbidden("Assistant requires a user-backed actor")));
    const snapshot = await loadAssistantChatContextSnapshot(user.id, c.req.param("conversationId")!);
    return snapshot ? respond(c, ok(snapshot)) : respond(c, fail(err.notFound("Conversation")));
  })
  .get("/workspace/projects/:projectId/context", async (c) => {
    const snapshot = await loadAssistantProjectContextSnapshot(c.get("accessSubject"), c.req.param("projectId")!);
    return snapshot ? respond(c, ok(snapshot)) : respond(c, fail(err.notFound("Project")));
  })
  .route("/", chatTaskRoutes)
  .route("/", chatRoutes);

export default app;
export type ApiType = typeof app;
