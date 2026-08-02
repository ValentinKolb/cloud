import { createAiChatRoutes } from "@valentinkolb/cloud/ai";
import { type AuthContext, auth, err, fail, type RequestActor, rateLimit, respond } from "@valentinkolb/cloud/server";
import type { Context } from "hono";
import { Hono } from "hono";

const ASSISTANT_APP_ID = "assistant";
const ASSISTANT_SYSTEM_PROMPT =
  "You are the general-purpose Assistant app. Help with writing, rewriting, summarizing, explaining, and planning.";

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
  retryInstruction,
  resolveContext: async (c: Context<AuthContext>) => {
    const actor = c.get("actor") as RequestActor;
    const user = actorUser(c);
    if (!user) return respond(c, fail(err.forbidden("Assistant requires a user-backed actor")));
    return {
      actor,
      ownerUserId: user.id,
      toolSource: { kind: "default", capabilities: true },
      systemPrompt: ASSISTANT_SYSTEM_PROMPT,
      modelPolicy: { kind: "selectable", requiredCapabilities: ["streaming"] },
      toolApprovalContext: { actorUserId: user.id, appId: ASSISTANT_APP_ID, resource: { kind: "direct" } },
    };
  },
});

const app = new Hono<AuthContext>()
  .use(rateLimit())
  .use("*", auth.requireRole("authenticated"))
  .use("*", auth.requireUser())
  .route("/", chatRoutes);

export default app;
export type ApiType = typeof app;
