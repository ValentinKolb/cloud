import { createAiChatRoutes, defineAiResource, defineAiTool, runAiStructured } from "@valentinkolb/cloud/ai";
import { type AccessSubject, type AuthContext, auth, expectUserBackedActor, middleware } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { z } from "zod";

type InventoryItem = {
  id: string;
  name: string;
  stock: number;
};

const loadItemForActor = async (itemId: string, _actor: AuthContext["Variables"]["actor"]): Promise<InventoryItem | null> => ({
  id: itemId,
  name: "Steel bolts",
  stock: 12,
});

const updateItemForActor = async (input: {
  itemId: string;
  name: string;
  actor: AuthContext["Variables"]["actor"];
  signal: AbortSignal;
}) => {
  const item = await loadItemForActor(input.itemId, input.actor);
  if (!item) throw new Error("Item not found");
  if (input.signal.aborted) throw input.signal.reason;
  return { ...item, name: input.name };
};

const loadItemForAi = async (input: { itemId: string; actor: AuthContext["Variables"]["actor"]; accessSubject: AccessSubject }) => {
  const item = await loadItemForActor(input.itemId, input.actor);
  if (!item || !input.accessSubject) return null;
  return {
    name: item.name,
    description: `Current stock: ${item.stock}`,
  };
};

export const itemAi = defineAiResource({
  appId: "inventory",
  id: "item",
  path: "/items/:itemId",
  params: z.object({ itemId: z.string().uuid() }),
  access: async ({ params, actor }) => {
    const item = await loadItemForActor(params.itemId, actor);
    return item ? { allowed: true, data: item } : { allowed: false, reason: "Item not found" };
  },
  resourceId: "itemId",
  resourceTitle: ({ access }) => access.name,
  modelPolicy: {
    kind: "selectable",
    requiredCapabilities: ["streaming", "tools"],
  },
  systemPrompt: "Help the user understand and update this item.",
  context: ({ access }) =>
    JSON.stringify({
      id: access.id,
      name: access.name,
      stock: access.stock,
    }),
  tools: ({ params }) => [
    defineAiTool({
      name: "update_item",
      description: "Update this inventory item.",
      inputSchema: z.object({ name: z.string().min(1) }),
      outputSchema: z.object({ updated: z.boolean() }),
      approval: "once",
      timeoutMs: 10_000,
    }).server(async ({ name }, { actor, signal }) => {
      await updateItemForActor({
        itemId: params.itemId,
        name,
        actor,
        signal,
      });
      return { updated: true };
    }),
  ],
});

export const aiRoutes = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .use("*", auth.requireRole("authenticated"))
  .use("*", auth.requireUser())
  .route("/api/inventory/ai", itemAi.routes());

const assistantChatRoutes = createAiChatRoutes({
  appId: "assistant",
  allowConversationManagement: true,
  modelListPolicy: {
    kind: "selectable",
    requiredCapabilities: ["streaming"],
  },
  resolveContext: async (c) => {
    const actor = c.get("actor");
    const user = expectUserBackedActor(c);
    return {
      actor,
      ownerUserId: user.id,
      toolSource: { kind: "default" },
      systemPrompt: "Help with writing and planning.",
      modelPolicy: {
        kind: "selectable",
        requiredCapabilities: ["streaming"],
      },
      toolApprovalContext: {
        actorUserId: user.id,
        appId: "assistant",
        resource: { kind: "direct" },
      },
    };
  },
});

const assistantChatApi = new Hono<AuthContext>()
  .use("*", auth.requireRole("authenticated"))
  .use("*", auth.requireUser())
  .route("/", assistantChatRoutes);

export const assistantAiRoutes = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/assistant", assistantChatApi);

const ClassificationSchema = z.object({
  category: z.enum(["hardware", "office", "other"]),
  confidence: z.number().min(0).max(1),
});

export const classifyItem = async (input: {
  itemId: string;
  actor: AuthContext["Variables"]["actor"];
  accessSubject: AccessSubject;
  signal?: AbortSignal;
}) => {
  const item = await loadItemForAi(input);
  if (!item) throw new Error("Item not found");

  return runAiStructured({
    task: "inventory-categorize",
    appId: "inventory",
    input: JSON.stringify(item),
    systemPrompt: "Classify the item using the supplied text only.",
    outputName: "classification",
    output: ClassificationSchema,
    temperature: 0,
    maxOutputTokens: 200,
    signal: input.signal,
  });
};
