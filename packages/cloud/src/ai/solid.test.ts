import { describe, expect, test } from "bun:test";
import { createRoot } from "solid-js";
import { createAiChatController } from "./solid";
import type { AiConversation, AiStoredMessage } from "./types";

const encoder = new TextEncoder();

const sse = (events: unknown[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(event)}\n\n`));
        }
        controller.close();
      },
    }),
  );

const conversation: AiConversation = {
  id: "conversation-1",
  appId: "assistant",
  title: "Conversation",
  icon: "ti ti-message",
  description: "",
  resource: { kind: "direct" },
  createdByUserId: "11111111-1111-4111-8111-111111111111",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const noLoopMetadata = {
  loopId: null,
  loopAggregate: null,
  loopDoneReason: null,
} satisfies Pick<AiStoredMessage, "loopId" | "loopAggregate" | "loopDoneReason">;

const messageActions = {
  messages: {
    ":messageId": {
      fork: {
        $post: async () => Response.json({ conversation, messages: [], activeTurn: null, pendingActions: [] }),
      },
      retry: {
        $post: async () => sse([]),
      },
    },
  },
};

describe("AI Solid chat controller", () => {
  test("does not abort a detached server turn when the controller is disposed", () => {
    let abortCalls = 0;
    const route = {
      conversations: {
        $get: async () => Response.json([conversation]),
        $post: async () => Response.json(conversation),
        ":conversationId": {
          ...messageActions,
          $get: async () => Response.json({ conversation, messages: [], activeTurn: null }),
          turns: {
            $post: async () => sse([]),
            ":turnId": {
              abort: {
                $post: async () => {
                  abortCalls += 1;
                  return Response.json({ ok: true });
                },
              },
              actions: {
                ":callId": {
                  $post: async () => Response.json({ ok: true }),
                },
              },
              events: {
                $get: async () => sse([]),
              },
            },
          },
        },
      },
    };

    createRoot((dispose) => {
      createAiChatController({
        route,
        initialConversations: [conversation],
        initialConversationId: conversation.id,
        initialActiveTurn: {
          id: "turn-1",
          conversationId: conversation.id,
          status: "running",
          modelProfileId: "model-1",
          createdAt: new Date().toISOString(),
          completedAt: null,
          error: null,
        },
        autoResume: false,
      });
      dispose();
    });

    expect(abortCalls).toBe(0);
  });

  test("successful abort detaches the active turn locally", async () => {
    let abortCalls = 0;
    const route = {
      conversations: {
        $get: async () => Response.json([conversation]),
        $post: async () => Response.json(conversation),
        ":conversationId": {
          ...messageActions,
          $get: async () => Response.json({ conversation, messages: [], activeTurn: null, pendingActions: [] }),
          turns: {
            $post: async () => sse([]),
            ":turnId": {
              abort: {
                $post: async () => {
                  abortCalls += 1;
                  return Response.json({ ok: true });
                },
              },
              actions: {
                ":callId": {
                  $post: async () => Response.json({ ok: true }),
                },
              },
              events: {
                $get: async () => sse([]),
              },
            },
          },
        },
      },
    };

    await createRoot(async (dispose) => {
      const chat = createAiChatController({
        route,
        initialConversations: [conversation],
        initialConversationId: conversation.id,
        initialActiveTurn: {
          id: "turn-1",
          conversationId: conversation.id,
          status: "running",
          modelProfileId: "model-1",
          createdAt: new Date().toISOString(),
          completedAt: null,
          error: null,
        },
        autoResume: false,
      });

      chat.abort();
      expect(chat.runStatus()).toBe("stopping");
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(abortCalls).toBe(1);
      expect(chat.activeTurn()).toBeNull();
      expect(chat.runStatus()).toBe("idle");
      expect(chat.running()).toBe(false);
      expect(chat.error()).toBeNull();
      dispose();
    });
  });

  test("keeps initial pending approval requests available without replay", () => {
    const route = {
      conversations: {
        $get: async () => Response.json([conversation]),
        $post: async () => Response.json(conversation),
        ":conversationId": {
          ...messageActions,
          $get: async () => Response.json({ conversation, messages: [], activeTurn: null, pendingActions: [] }),
          turns: {
            $post: async () => sse([]),
            ":turnId": {
              abort: {
                $post: async () => Response.json({ ok: true }),
              },
              actions: {
                ":callId": {
                  $post: async () => Response.json({ ok: true }),
                },
              },
              events: {
                $get: async () => sse([]),
              },
            },
          },
        },
      },
    };

    createRoot((dispose) => {
      const chat = createAiChatController({
        route,
        initialConversations: [conversation],
        initialConversationId: conversation.id,
        initialActiveTurn: {
          id: "turn-1",
          conversationId: conversation.id,
          status: "running",
          modelProfileId: "model-1",
          createdAt: new Date().toISOString(),
          completedAt: null,
          error: null,
        },
        initialPendingActions: [
          {
            type: "approval_request",
            conversationId: conversation.id,
            turnId: "turn-1",
            callId: "call-1",
            name: "write_record",
            args: { title: "Draft" },
            allowAlways: true,
          },
        ],
        autoResume: false,
      });

      expect(chat.approvalRequests()).toHaveLength(1);
      expect(chat.approvalRequests()[0]?.callId).toBe("call-1");
      expect(chat.runStatus()).toBe("waiting_for_action");
      expect(chat.running()).toBe(true);
      expect(chat.assistantBlocks()).toMatchObject([
        { type: "approval_request", status: "pending", request: { callId: "call-1", name: "write_record" } },
      ]);
      expect(chat.assistantBlocks()[0]?.id).toBe("approval-turn-1-call-1");
      dispose();
    });
  });

  test("auto-acknowledges default visual client-view tools", async () => {
    let postedAction: unknown = null;
    const route = {
      conversations: {
        $get: async () => Response.json([conversation]),
        $post: async () => Response.json(conversation),
        ":conversationId": {
          ...messageActions,
          $get: async () => Response.json({ conversation, messages: [], activeTurn: null, pendingActions: [] }),
          turns: {
            $post: async () => sse([]),
            ":turnId": {
              abort: {
                $post: async () => Response.json({ ok: true }),
              },
              actions: {
                ":callId": {
                  $post: async (input: { json?: unknown }) => {
                    postedAction = input.json;
                    return Response.json({ ok: true });
                  },
                },
              },
              events: {
                $get: async () => sse([]),
              },
            },
          },
        },
      },
    };

    await createRoot(async (dispose) => {
      createAiChatController({
        route,
        initialConversations: [conversation],
        initialConversationId: conversation.id,
        initialActiveTurn: {
          id: "turn-1",
          conversationId: conversation.id,
          status: "running",
          modelProfileId: "model-1",
          createdAt: new Date().toISOString(),
          completedAt: null,
          error: null,
        },
        initialPendingActions: [
          {
            type: "frontend_tool",
            conversationId: conversation.id,
            turnId: "turn-1",
            callId: "call-card",
            name: "cloud_card",
            args: { title: "Revenue", value: "42" },
            mode: "client_view",
          },
        ],
        autoResume: false,
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(postedAction).toEqual({ type: "tool_result", result: { displayed: true } });
      dispose();
    });
  });

  test("forks a conversation from a selected message and opens the fork", async () => {
    const forkedConversation = { ...conversation, id: "conversation-fork", title: "Fork" };
    const forkedMessage: AiStoredMessage = {
      id: "message-1",
      conversationId: forkedConversation.id,
      seq: 1,
      kind: "message",
      message: { role: "user", content: [{ type: "text", text: "hello" }] },
      modelProfileId: null,
      providerModel: null,
      usage: null,
      stopReason: null,
      ...noLoopMetadata,
      createdAt: new Date().toISOString(),
    };
    let postedFork: unknown = null;
    const route = {
      conversations: {
        $get: async () => Response.json([forkedConversation, conversation]),
        $post: async () => Response.json(conversation),
        ":conversationId": {
          messages: {
            ":messageId": {
              fork: {
                $post: async (input: { param?: Record<string, string>; json?: unknown }) => {
                  postedFork = input;
                  return Response.json({
                    conversation: forkedConversation,
                    messages: [forkedMessage],
                    activeTurn: null,
                    pendingActions: [],
                  });
                },
              },
              retry: {
                $post: async () => sse([]),
              },
            },
          },
          $get: async () => Response.json({ conversation, messages: [], activeTurn: null, pendingActions: [] }),
          turns: {
            $post: async () => sse([]),
            ":turnId": {
              abort: {
                $post: async () => Response.json({ ok: true }),
              },
              actions: {
                ":callId": {
                  $post: async () => Response.json({ ok: true }),
                },
              },
              events: {
                $get: async () => sse([]),
              },
            },
          },
        },
      },
    };

    await createRoot(async (dispose) => {
      const chat = createAiChatController({
        route,
        initialConversations: [conversation],
        initialConversationId: conversation.id,
        autoResume: false,
      });

      const forked = await chat.forkMessage("message-2");
      expect(forked?.id).toBe(forkedConversation.id);
      expect(chat.activeConversationId()).toBe(forkedConversation.id);
      expect(chat.messages()).toEqual([forkedMessage]);
      expect(postedFork).toMatchObject({ param: { conversationId: conversation.id, messageId: "message-2" } });
      dispose();
    });
  });

  test("creating a new conversation detaches a stale running stream", async () => {
    const runningTurn = {
      id: "turn-running",
      conversationId: conversation.id,
      status: "running" as const,
      modelProfileId: "model-1",
      createdAt: new Date().toISOString(),
      completedAt: null,
      error: null,
    };
    const nextConversation = { ...conversation, id: "conversation-new", title: "New chat" };
    let streamClosed = false;
    const route = {
      conversations: {
        $get: async () => Response.json([nextConversation, conversation]),
        $post: async () => Response.json(nextConversation),
        ":conversationId": {
          ...messageActions,
          $get: async () => Response.json({ conversation, messages: [], activeTurn: runningTurn, pendingActions: [] }),
          turns: {
            $post: async () => sse([]),
            ":turnId": {
              abort: {
                $post: async () => Response.json({ ok: true }),
              },
              actions: {
                ":callId": {
                  $post: async () => Response.json({ ok: true }),
                },
              },
              events: {
                $get: async (_input: unknown, request?: { init?: { signal?: AbortSignal } }) =>
                  new Response(
                    new ReadableStream<Uint8Array>({
                      start(controller) {
                        request?.init?.signal?.addEventListener(
                          "abort",
                          () => {
                            streamClosed = true;
                            controller.close();
                          },
                          { once: true },
                        );
                      },
                    }),
                  ),
              },
            },
          },
        },
      },
    };

    await createRoot(async (dispose) => {
      const chat = createAiChatController({
        route,
        initialConversations: [conversation],
        initialConversationId: conversation.id,
        autoResume: false,
      });

      const resumePromise = chat.resume({ conversationId: conversation.id, turnId: runningTurn.id });
      for (let attempt = 0; attempt < 10 && !chat.running(); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(chat.running()).toBe(true);

      const created = await chat.createConversation();
      expect(created?.id).toBe(nextConversation.id);
      expect(chat.activeConversationId()).toBe(nextConversation.id);
      expect(chat.running()).toBe(false);
      expect(chat.activeTurn()).toBe(null);
      expect(chat.messages()).toEqual([]);
      expect(streamClosed).toBe(true);
      await resumePromise;
      dispose();
    });
  });

  test("first send can create a conversation without detaching its own run", async () => {
    const createdConversation = { ...conversation, id: "conversation-created", title: "New chat" };
    const assistantMessage: AiStoredMessage = {
      id: "message-created-assistant",
      conversationId: createdConversation.id,
      seq: 2,
      kind: "message",
      message: { role: "assistant", content: [{ type: "text", text: "created answer" }] },
      modelProfileId: "model-1",
      providerModel: "provider/model",
      usage: null,
      stopReason: "stop",
      ...noLoopMetadata,
      createdAt: new Date().toISOString(),
    };
    const route = {
      conversations: {
        $get: async () => Response.json([createdConversation]),
        $post: async () => Response.json(createdConversation),
        ":conversationId": {
          ...messageActions,
          $get: async () =>
            Response.json({ conversation: createdConversation, messages: [assistantMessage], activeTurn: null, pendingActions: [] }),
          turns: {
            $post: async () =>
              sse([
                {
                  type: "turn_start",
                  conversationId: createdConversation.id,
                  turnId: "turn-created",
                  modelProfileId: "model-1",
                  providerModel: "provider/model",
                  cursor: "1-0",
                },
                {
                  type: "nessi",
                  conversationId: createdConversation.id,
                  turnId: "turn-created",
                  event: { type: "text", agentId: "cloud", delta: "created answer" },
                  cursor: "2-0",
                },
                {
                  type: "nessi",
                  conversationId: createdConversation.id,
                  turnId: "turn-created",
                  event: { type: "turn_end", agentId: "cloud", message: assistantMessage.message },
                  cursor: "3-0",
                },
                { type: "done", conversationId: createdConversation.id, turnId: "turn-created", reason: "stop", aggregate: null, cursor: "4-0" },
              ]),
            ":turnId": {
              abort: {
                $post: async () => Response.json({ ok: true }),
              },
              actions: {
                ":callId": {
                  $post: async () => Response.json({ ok: true }),
                },
              },
              events: {
                $get: async () => sse([]),
              },
            },
          },
        },
      },
    };

    await createRoot(async (dispose) => {
      const chat = createAiChatController({
        route,
        initialConversations: [],
        initialConversationId: null,
        autoResume: false,
      });

      const sent = await chat.send({ message: "hello", modelProfileId: "model-1" });
      expect(sent).toBe(true);
      expect(chat.activeConversationId()).toBe(createdConversation.id);
      expect(chat.running()).toBe(false);
      expect(chat.messages()).toEqual([assistantMessage]);
      dispose();
    });
  });

  test("retries a user message in the current conversation", async () => {
    const userMessage: AiStoredMessage = {
      id: "message-user",
      conversationId: conversation.id,
      seq: 1,
      kind: "message",
      message: { role: "user", content: [{ type: "text", text: "write this again" }] },
      modelProfileId: null,
      providerModel: null,
      usage: null,
      stopReason: null,
      ...noLoopMetadata,
      createdAt: new Date().toISOString(),
    };
    const assistantMessage: AiStoredMessage = {
      id: "message-assistant",
      conversationId: conversation.id,
      seq: 2,
      kind: "message",
      message: { role: "assistant", content: [{ type: "text", text: "old answer" }] },
      modelProfileId: "model-1",
      providerModel: "provider/model",
      usage: null,
      stopReason: "stop",
      ...noLoopMetadata,
      createdAt: new Date().toISOString(),
    };
    const retriedUserMessage: AiStoredMessage = {
      ...userMessage,
      id: "message-user-retry",
      message: { role: "user", content: [{ type: "text", text: "write this better" }] },
    };
    const regeneratedMessage: AiStoredMessage = {
      ...assistantMessage,
      id: "message-regenerated",
      message: { role: "assistant", content: [{ type: "text", text: "new answer" }] },
    };
    let postedRetry: unknown = null;
    const route = {
      conversations: {
        $get: async () => Response.json([conversation]),
        $post: async () => Response.json(conversation),
        ":conversationId": {
          messages: {
            ":messageId": {
              fork: {
                $post: async () => Response.json({ conversation, messages: [], activeTurn: null, pendingActions: [] }),
              },
              retry: {
                $post: async (input: { param?: Record<string, string>; json?: unknown }) => {
                  postedRetry = input;
                  return sse([
                    {
                      type: "turn_start",
                      conversationId: conversation.id,
                      turnId: "turn-regenerate",
                      modelProfileId: "model-1",
                      providerModel: "provider/model",
                      cursor: "1-0",
                    },
                    {
                      type: "nessi",
                      conversationId: conversation.id,
                      turnId: "turn-regenerate",
                      event: { type: "text", agentId: "cloud", delta: "new answer" },
                      cursor: "2-0",
                    },
                    {
                      type: "nessi",
                      conversationId: conversation.id,
                      turnId: "turn-regenerate",
                      event: {
                        type: "turn_end",
                        agentId: "cloud",
                        message: regeneratedMessage.message,
                      },
                      cursor: "3-0",
                    },
                    { type: "done", conversationId: conversation.id, turnId: "turn-regenerate", reason: "stop", aggregate: null, cursor: "4-0" },
                  ]);
                },
              },
            },
          },
          $get: async () =>
            Response.json({
              conversation,
              messages: [retriedUserMessage, regeneratedMessage],
              activeTurn: null,
              pendingActions: [],
            }),
          turns: {
            $post: async () => sse([]),
            ":turnId": {
              abort: {
                $post: async () => Response.json({ ok: true }),
              },
              actions: {
                ":callId": {
                  $post: async () => Response.json({ ok: true }),
                },
              },
              events: {
                $get: async () => sse([]),
              },
            },
          },
        },
      },
    };

    await createRoot(async (dispose) => {
      const chat = createAiChatController({
        route,
        initialConversations: [conversation],
        initialConversationId: conversation.id,
        initialMessages: [userMessage, assistantMessage],
        autoResume: false,
      });

      const retried = await chat.retryUserMessage("message-user", {
        mode: "concise",
        content: [{ type: "text", text: "write this better" }],
        modelProfileId: "model-1",
      });
      expect(retried).toBe(true);
      expect(chat.activeConversationId()).toBe(conversation.id);
      expect(chat.messages()).toEqual([retriedUserMessage, regeneratedMessage]);
      expect(postedRetry).toMatchObject({
        param: { conversationId: conversation.id, messageId: "message-user" },
        json: { mode: "concise", content: [{ type: "text", text: "write this better" }], modelProfileId: "model-1" },
      });
      dispose();
    });
  });

  test("retries when the local active turn is stale and the backend accepts the retry", async () => {
    const activeTurn = {
      id: "turn-stale",
      conversationId: conversation.id,
      status: "running" as const,
      modelProfileId: "model-1",
      createdAt: new Date().toISOString(),
      completedAt: null,
      error: null,
    };
    const userMessage: AiStoredMessage = {
      id: "message-user",
      conversationId: conversation.id,
      seq: 1,
      kind: "message",
      message: { role: "user", content: [{ type: "text", text: "write this again" }] },
      modelProfileId: null,
      providerModel: null,
      usage: null,
      stopReason: null,
      ...noLoopMetadata,
      createdAt: new Date().toISOString(),
    };
    const assistantMessage: AiStoredMessage = {
      id: "message-assistant",
      conversationId: conversation.id,
      seq: 2,
      kind: "message",
      message: { role: "assistant", content: [{ type: "text", text: "old answer" }] },
      modelProfileId: "model-1",
      providerModel: "provider/model",
      usage: null,
      stopReason: "stop",
      ...noLoopMetadata,
      createdAt: new Date().toISOString(),
    };
    const retriedAssistantMessage: AiStoredMessage = {
      ...assistantMessage,
      id: "message-retried-assistant",
      message: { role: "assistant", content: [{ type: "text", text: "new answer" }] },
    };
    let postedRetry: unknown = null;
    const route = {
      conversations: {
        $get: async () => Response.json([conversation]),
        $post: async () => Response.json(conversation),
        ":conversationId": {
          messages: {
            ":messageId": {
              fork: {
                $post: async () => Response.json({ conversation, messages: [], activeTurn: null, pendingActions: [] }),
              },
              retry: {
                $post: async (input: { param?: Record<string, string>; json?: unknown }) => {
                  postedRetry = input;
                  return sse([
                    {
                      type: "turn_start",
                      conversationId: conversation.id,
                      turnId: "turn-retry",
                      modelProfileId: "model-1",
                      providerModel: "provider/model",
                      cursor: "1-0",
                    },
                    { type: "done", conversationId: conversation.id, turnId: "turn-retry", reason: "stop", aggregate: null, cursor: "2-0" },
                  ]);
                },
              },
            },
          },
          $get: async () =>
            Response.json({
              conversation,
              messages: [userMessage, retriedAssistantMessage],
              activeTurn: null,
              pendingActions: [],
            }),
          turns: {
            $post: async () => sse([]),
            ":turnId": {
              abort: {
                $post: async () => Response.json({ ok: true }),
              },
              actions: {
                ":callId": {
                  $post: async () => Response.json({ ok: true }),
                },
              },
              events: {
                $get: async () => sse([]),
              },
            },
          },
        },
      },
    };

    await createRoot(async (dispose) => {
      const chat = createAiChatController({
        route,
        initialConversations: [conversation],
        initialConversationId: conversation.id,
        initialMessages: [userMessage, assistantMessage],
        initialActiveTurn: activeTurn,
        autoResume: false,
      });

      expect(chat.activeTurn()?.turnId).toBe("turn-stale");
      const retried = await chat.retryUserMessage("message-user", { modelProfileId: "model-1" });

      expect(retried).toBe(true);
      expect(postedRetry).toMatchObject({ param: { conversationId: conversation.id, messageId: "message-user" } });
      expect(chat.activeTurn()).toBe(null);
      expect(chat.messages()).toEqual([userMessage, retriedAssistantMessage]);
      dispose();
    });
  });

  test("rolls back retry state when the backend reports a running turn", async () => {
    const activeTurn = {
      id: "turn-running",
      conversationId: conversation.id,
      status: "running" as const,
      modelProfileId: "model-1",
      createdAt: new Date().toISOString(),
      completedAt: null,
      error: null,
    };
    const userMessage: AiStoredMessage = {
      id: "message-user",
      conversationId: conversation.id,
      seq: 1,
      kind: "message",
      message: { role: "user", content: [{ type: "text", text: "write this again" }] },
      modelProfileId: null,
      providerModel: null,
      usage: null,
      stopReason: null,
      ...noLoopMetadata,
      createdAt: new Date().toISOString(),
    };
    const assistantMessage: AiStoredMessage = {
      id: "message-assistant",
      conversationId: conversation.id,
      seq: 2,
      kind: "message",
      message: { role: "assistant", content: [{ type: "text", text: "old answer" }] },
      modelProfileId: "model-1",
      providerModel: "provider/model",
      usage: null,
      stopReason: "stop",
      ...noLoopMetadata,
      createdAt: new Date().toISOString(),
    };
    let postedRetry: unknown = null;
    const route = {
      conversations: {
        $get: async () => Response.json([conversation]),
        $post: async () => Response.json(conversation),
        ":conversationId": {
          messages: {
            ":messageId": {
              fork: {
                $post: async () => Response.json({ conversation, messages: [], activeTurn: null, pendingActions: [] }),
              },
              retry: {
                $post: async (input: { param?: Record<string, string>; json?: unknown }) => {
                  postedRetry = input;
                  return Response.json({ message: "Running turn" }, { status: 409 });
                },
              },
            },
          },
          $get: async () => Response.json({ conversation, messages: [userMessage, assistantMessage], activeTurn, pendingActions: [] }),
          turns: {
            $post: async () => sse([]),
            ":turnId": {
              abort: {
                $post: async () => Response.json({ ok: true }),
              },
              actions: {
                ":callId": {
                  $post: async () => Response.json({ ok: true }),
                },
              },
              events: {
                $get: async () => sse([]),
              },
            },
          },
        },
      },
    };

    await createRoot(async (dispose) => {
      const chat = createAiChatController({
        route,
        initialConversations: [conversation],
        initialConversationId: conversation.id,
        initialMessages: [userMessage, assistantMessage],
        initialActiveTurn: activeTurn,
        autoResume: false,
      });

      const retried = await chat.retryUserMessage("message-user", { modelProfileId: "model-1" });

      expect(retried).toBe(false);
      expect(postedRetry).toMatchObject({ param: { conversationId: conversation.id, messageId: "message-user" } });
      expect(chat.messages()).toEqual([userMessage, assistantMessage]);
      expect(chat.activeTurn()?.turnId).toBe("turn-running");
      expect(chat.error()).toBe("Running turn");
      dispose();
    });
  });

  test("keeps the partial assistant draft when a stream closes before a final event", async () => {
    const activeTurn = {
      id: "turn-1",
      conversationId: conversation.id,
      status: "running" as const,
      modelProfileId: "model-1",
      createdAt: new Date().toISOString(),
      completedAt: null,
      error: null,
    };
    const route = {
      conversations: {
        $get: async () => Response.json([conversation]),
        $post: async () => Response.json(conversation),
        ":conversationId": {
          ...messageActions,
          $get: async () => Response.json({ conversation, messages: [], activeTurn, pendingActions: [] }),
          turns: {
            $post: async () =>
              sse([
                {
                  type: "turn_start",
                  conversationId: conversation.id,
                  turnId: "turn-1",
                  modelProfileId: "model-1",
                  providerModel: "provider/model",
                  cursor: "1-0",
                },
                {
                  type: "nessi",
                  conversationId: conversation.id,
                  turnId: "turn-1",
                  event: { type: "text", agentId: "cloud", delta: "partial answer" },
                  cursor: "2-0",
                },
              ]),
            ":turnId": {
              abort: {
                $post: async () => Response.json({ ok: true }),
              },
              actions: {
                ":callId": {
                  $post: async () => Response.json({ ok: true }),
                },
              },
              events: {
                $get: async () => sse([]),
              },
            },
          },
        },
      },
    };

    await createRoot(async (dispose) => {
      const chat = createAiChatController({
        route,
        initialConversations: [conversation],
        initialConversationId: conversation.id,
        autoResume: false,
      });

      await chat.send({ message: "hello" });
      expect(chat.assistantDraft()).toBe("partial answer");
      expect(chat.activeTurn()?.turnId).toBe("turn-1");
      dispose();
    });
  });

  test("does not render a tool block for a partial tool_start without a tool_call", async () => {
    const activeTurn = {
      id: "turn-tool-start",
      conversationId: conversation.id,
      status: "running" as const,
      modelProfileId: "model-1",
      createdAt: new Date().toISOString(),
      completedAt: null,
      error: null,
    };
    const route = {
      conversations: {
        $get: async () => Response.json([conversation]),
        $post: async () => Response.json(conversation),
        ":conversationId": {
          ...messageActions,
          $get: async () => Response.json({ conversation, messages: [], activeTurn, pendingActions: [] }),
          turns: {
            $post: async () =>
              sse([
                {
                  type: "turn_start",
                  conversationId: conversation.id,
                  turnId: "turn-tool-start",
                  loopId: "turn-tool-start",
                  modelProfileId: "model-1",
                  providerModel: "provider/model",
                  cursor: "1-0",
                },
                {
                  type: "nessi",
                  conversationId: conversation.id,
                  turnId: "turn-tool-start",
                  loopId: "turn-tool-start",
                  event: { type: "tool_start", agentId: "cloud", loopId: "turn-tool-start", callId: "call-card", name: "card" },
                  cursor: "2-0",
                },
                {
                  type: "nessi",
                  conversationId: conversation.id,
                  turnId: "turn-tool-start",
                  loopId: "turn-tool-start",
                  event: { type: "text", agentId: "cloud", loopId: "turn-tool-start", delta: "not actually a tool call" },
                  cursor: "3-0",
                },
              ]),
            ":turnId": {
              abort: {
                $post: async () => Response.json({ ok: true }),
              },
              actions: {
                ":callId": {
                  $post: async () => Response.json({ ok: true }),
                },
              },
              events: {
                $get: async () => sse([]),
              },
            },
          },
        },
      },
    };

    await createRoot(async (dispose) => {
      const chat = createAiChatController({
        route,
        initialConversations: [conversation],
        initialConversationId: conversation.id,
        autoResume: false,
      });

      await chat.send({ message: "test card" });
      expect(chat.assistantBlocks().some((block) => block.type === "tool_call")).toBe(false);
      expect(chat.assistantDraft()).toBe("not actually a tool call");
      dispose();
    });
  });

  test("does not render executable tool blocks for tool stream issues", async () => {
    const activeTurn = {
      id: "turn-tool-issue",
      conversationId: conversation.id,
      status: "running" as const,
      modelProfileId: "model-1",
      createdAt: new Date().toISOString(),
      completedAt: null,
      error: null,
    };
    const route = {
      conversations: {
        $get: async () => Response.json([conversation]),
        $post: async () => Response.json(conversation),
        ":conversationId": {
          ...messageActions,
          $get: async () => Response.json({ conversation, messages: [], activeTurn, pendingActions: [] }),
          turns: {
            $post: async () =>
              sse([
                {
                  type: "turn_start",
                  conversationId: conversation.id,
                  turnId: "turn-tool-issue",
                  loopId: "turn-tool-issue",
                  modelProfileId: "model-1",
                  providerModel: "provider/model",
                  cursor: "1-0",
                },
                {
                  type: "nessi",
                  conversationId: conversation.id,
                  turnId: "turn-tool-issue",
                  loopId: "turn-tool-issue",
                  event: {
                    type: "tool_error",
                    agentId: "cloud",
                    loopId: "turn-tool-issue",
                    callId: "call-bad",
                    name: "card",
                    reason: "text_during_tool_call",
                    message: "Text arrived while a tool call was open.",
                    textDelta: "plain text",
                  },
                  cursor: "2-0",
                },
                {
                  type: "nessi",
                  conversationId: conversation.id,
                  turnId: "turn-tool-issue",
                  loopId: "turn-tool-issue",
                  event: {
                    type: "tool_cancel",
                    agentId: "cloud",
                    loopId: "turn-tool-issue",
                    callId: "call-cancelled",
                    name: "card",
                    reason: "stream_ended_before_tool_call",
                    message: "The stream ended before the tool call was complete.",
                  },
                  cursor: "3-0",
                },
              ]),
            ":turnId": {
              abort: {
                $post: async () => Response.json({ ok: true }),
              },
              actions: {
                ":callId": {
                  $post: async () => Response.json({ ok: true }),
                },
              },
              events: {
                $get: async () => sse([]),
              },
            },
          },
        },
      },
    };

    await createRoot(async (dispose) => {
      const chat = createAiChatController({
        route,
        initialConversations: [conversation],
        initialConversationId: conversation.id,
        autoResume: false,
      });

      await chat.send({ message: "test tool issue" });
      expect(chat.assistantBlocks().some((block) => block.type === "tool_call")).toBe(false);
      expect(chat.error()).toBeNull();
      dispose();
    });
  });

  test("commits a completed assistant message after draining streamed text", async () => {
    const assistantMessage = {
      id: "message-2",
      conversationId: conversation.id,
      seq: 2,
      kind: "message" as const,
      message: { role: "assistant" as const, content: [{ type: "text" as const, text: "completed answer" }] },
      modelProfileId: "model-1",
      providerModel: "provider/model",
      usage: null,
      stopReason: "stop",
      ...noLoopMetadata,
      createdAt: new Date().toISOString(),
    };
    const route = {
      conversations: {
        $get: async () => Response.json([conversation]),
        $post: async () => Response.json(conversation),
        ":conversationId": {
          ...messageActions,
          $get: async () => Response.json({ conversation, messages: [assistantMessage], activeTurn: null, pendingActions: [] }),
          turns: {
            $post: async () =>
              sse([
                {
                  type: "turn_start",
                  conversationId: conversation.id,
                  turnId: "turn-1",
                  modelProfileId: "model-1",
                  providerModel: "provider/model",
                  cursor: "1-0",
                },
                {
                  type: "nessi",
                  conversationId: conversation.id,
                  turnId: "turn-1",
                  event: { type: "text", agentId: "cloud", delta: "completed answer" },
                  cursor: "2-0",
                },
                {
                  type: "nessi",
                  conversationId: conversation.id,
                  turnId: "turn-1",
                  event: {
                    type: "turn_end",
                    agentId: "cloud",
                    message: { role: "assistant", content: [{ type: "text", text: "completed answer" }] },
                  },
                  cursor: "3-0",
                },
                { type: "done", conversationId: conversation.id, turnId: "turn-1", reason: "stop", aggregate: null, cursor: "4-0" },
              ]),
            ":turnId": {
              abort: {
                $post: async () => Response.json({ ok: true }),
              },
              actions: {
                ":callId": {
                  $post: async () => Response.json({ ok: true }),
                },
              },
              events: {
                $get: async () => sse([]),
              },
            },
          },
        },
      },
    };

    await createRoot(async (dispose) => {
      const chat = createAiChatController({
        route,
        initialConversations: [conversation],
        initialConversationId: conversation.id,
        autoResume: false,
      });

      const sendPromise = chat.send({ message: "hello" });
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(chat.assistantDraft()).toBe("complete");
      expect(chat.messages().some((entry) => entry.message.role === "assistant")).toBe(false);

      await sendPromise;
      expect(chat.assistantDraft()).toBe("");
      expect(chat.messages().at(-1)?.message).toEqual({ role: "assistant", content: [{ type: "text", text: "completed answer" }] });
      dispose();
    });
  });

  test("applies loop aggregate metadata from the final stream event before refresh", async () => {
    const finalMessage = { role: "assistant" as const, content: [{ type: "text" as const, text: "aggregated answer" }] };
    const aggregate: NonNullable<AiStoredMessage["loopAggregate"]> = {
      turns: [{ message: finalMessage, usage: { input: 7, output: 3, total: 10 }, stopReason: "stop", toolCalls: [] }],
      usage: { input: 7, output: 3, total: 10 },
      toolCallCount: 0,
      toolErrorCount: 0,
      toolIssueCount: 0,
      toolMalformedCount: 0,
      toolCancelledCount: 0,
      toolIssues: [],
      assistantMessageCount: 1,
    };
    const assistantMessage: AiStoredMessage = {
      id: "message-aggregate",
      conversationId: conversation.id,
      seq: 2,
      kind: "message",
      message: finalMessage,
      modelProfileId: "model-1",
      providerModel: "provider/model",
      usage: aggregate.usage ?? null,
      stopReason: "stop",
      loopId: "turn-aggregate",
      loopAggregate: aggregate,
      loopDoneReason: "stop",
      createdAt: new Date().toISOString(),
    };
    let releaseRefresh: (() => void) | undefined;
    const refreshGate = new Promise<Response>((resolve) => {
      releaseRefresh = () => resolve(Response.json({ conversation, messages: [assistantMessage], activeTurn: null, pendingActions: [] }));
    });
    const route = {
      conversations: {
        $get: async () => Response.json([conversation]),
        $post: async () => Response.json(conversation),
        ":conversationId": {
          ...messageActions,
          $get: async () => refreshGate,
          turns: {
            $post: async () =>
              sse([
                {
                  type: "turn_start",
                  conversationId: conversation.id,
                  turnId: "turn-aggregate",
                  modelProfileId: "model-1",
                  providerModel: "provider/model",
                  cursor: "1-0",
                },
                {
                  type: "nessi",
                  conversationId: conversation.id,
                  turnId: "turn-aggregate",
                  event: { type: "text", agentId: "cloud", delta: "aggregated answer" },
                  cursor: "2-0",
                },
                {
                  type: "nessi",
                  conversationId: conversation.id,
                  turnId: "turn-aggregate",
                  event: { type: "turn_end", agentId: "cloud", message: finalMessage },
                  cursor: "3-0",
                },
                {
                  type: "done",
                  conversationId: conversation.id,
                  turnId: "turn-aggregate",
                  reason: "stop",
                  aggregate,
                  cursor: "4-0",
                },
              ]),
            ":turnId": {
              abort: {
                $post: async () => Response.json({ ok: true }),
              },
              actions: {
                ":callId": {
                  $post: async () => Response.json({ ok: true }),
                },
              },
              events: {
                $get: async () => sse([]),
              },
            },
          },
        },
      },
    };

    await createRoot(async (dispose) => {
      const chat = createAiChatController({
        route,
        initialConversations: [conversation],
        initialConversationId: conversation.id,
        autoResume: false,
      });

      const sendPromise = chat.send({ message: "hello" });
      for (let attempt = 0; attempt < 20 && chat.messages().at(-1)?.message.role !== "assistant"; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(chat.messages().at(-1)).toMatchObject({
        message: finalMessage,
        usage: aggregate.usage,
        loopAggregate: aggregate,
        loopDoneReason: "stop",
      });

      releaseRefresh?.();
      await sendPromise;
      expect(chat.messages().at(-1)).toEqual(assistantMessage);
      dispose();
    });
  });

  test("keeps loop aggregate metadata on the final pending assistant turn", async () => {
    const firstMessage = { role: "assistant" as const, content: [{ type: "text" as const, text: "first answer" }] };
    const finalText = `second answer ${"x".repeat(320)}`;
    const finalMessage = { role: "assistant" as const, content: [{ type: "text" as const, text: finalText }] };
    const aggregate: NonNullable<AiStoredMessage["loopAggregate"]> = {
      turns: [
        { message: firstMessage, stopReason: "tool_use", toolCalls: [{ callId: "call-1", name: "card", args: { title: "A" } }] },
        { message: finalMessage, usage: { input: 12, output: 8, total: 20 }, stopReason: "stop", toolCalls: [] },
      ],
      usage: { input: 12, output: 8, total: 20 },
      toolCallCount: 1,
      toolErrorCount: 0,
      toolIssueCount: 0,
      toolMalformedCount: 0,
      toolCancelledCount: 0,
      toolIssues: [],
      assistantMessageCount: 2,
    };
    const firstStoredMessage: AiStoredMessage = {
      id: "message-first",
      conversationId: conversation.id,
      seq: 2,
      kind: "message",
      message: firstMessage,
      modelProfileId: "model-1",
      providerModel: "provider/model",
      usage: null,
      stopReason: "tool_use",
      ...noLoopMetadata,
      createdAt: new Date().toISOString(),
    };
    const finalStoredMessage: AiStoredMessage = {
      id: "message-final",
      conversationId: conversation.id,
      seq: 3,
      kind: "message",
      message: finalMessage,
      modelProfileId: "model-1",
      providerModel: "provider/model",
      usage: aggregate.usage ?? null,
      stopReason: "stop",
      loopId: "turn-loop",
      loopAggregate: aggregate,
      loopDoneReason: "stop",
      createdAt: new Date().toISOString(),
    };
    const route = {
      conversations: {
        $get: async () => Response.json([conversation]),
        $post: async () => Response.json(conversation),
        ":conversationId": {
          ...messageActions,
          $get: async () =>
            Response.json({ conversation, messages: [firstStoredMessage, finalStoredMessage], activeTurn: null, pendingActions: [] }),
          turns: {
            $post: async () =>
              sse([
                {
                  type: "turn_start",
                  conversationId: conversation.id,
                  turnId: "turn-loop",
                  modelProfileId: "model-1",
                  providerModel: "provider/model",
                  cursor: "1-0",
                },
                {
                  type: "nessi",
                  conversationId: conversation.id,
                  turnId: "turn-loop",
                  event: { type: "text", agentId: "cloud", delta: "first answer" },
                  cursor: "2-0",
                },
                {
                  type: "nessi",
                  conversationId: conversation.id,
                  turnId: "turn-loop",
                  event: { type: "turn_end", agentId: "cloud", message: firstMessage },
                  cursor: "3-0",
                },
                {
                  type: "nessi",
                  conversationId: conversation.id,
                  turnId: "turn-loop",
                  event: { type: "text", agentId: "cloud", delta: finalText },
                  cursor: "4-0",
                },
                {
                  type: "nessi",
                  conversationId: conversation.id,
                  turnId: "turn-loop",
                  event: { type: "turn_end", agentId: "cloud", message: finalMessage },
                  cursor: "5-0",
                },
                {
                  type: "done",
                  conversationId: conversation.id,
                  turnId: "turn-loop",
                  reason: "stop",
                  aggregate,
                  cursor: "6-0",
                },
              ]),
            ":turnId": {
              abort: {
                $post: async () => Response.json({ ok: true }),
              },
              actions: {
                ":callId": {
                  $post: async () => Response.json({ ok: true }),
                },
              },
              events: {
                $get: async () => sse([]),
              },
            },
          },
        },
      },
    };

    await createRoot(async (dispose) => {
      const chat = createAiChatController({
        route,
        initialConversations: [conversation],
        initialConversationId: conversation.id,
        autoResume: false,
      });

      const sendPromise = chat.send({ message: "hello" });
      await new Promise((resolve) => setTimeout(resolve, 80));
      const visibleAssistants = chat.messages().filter((entry) => entry.kind === "message" && entry.message.role === "assistant");
      expect(visibleAssistants).toHaveLength(1);
      expect(visibleAssistants[0]).toMatchObject({ message: firstMessage, loopAggregate: null, loopDoneReason: null });

      await sendPromise;
      expect(chat.messages()).toEqual([firstStoredMessage, finalStoredMessage]);
      dispose();
    });
  });

  test("ignores zero-turn done aggregates for previous assistant messages", async () => {
    const priorAssistant: AiStoredMessage = {
      id: "message-prior",
      conversationId: conversation.id,
      seq: 1,
      kind: "message",
      message: { role: "assistant", content: [{ type: "text", text: "previous answer" }] },
      modelProfileId: "model-1",
      providerModel: "provider/model",
      usage: null,
      stopReason: "stop",
      ...noLoopMetadata,
      createdAt: new Date().toISOString(),
    };
    const zeroTurnAggregate: NonNullable<AiStoredMessage["loopAggregate"]> = {
      turns: [],
      toolCallCount: 0,
      toolErrorCount: 0,
      toolIssueCount: 0,
      toolMalformedCount: 0,
      toolCancelledCount: 0,
      toolIssues: [],
      assistantMessageCount: 0,
    };
    const route = {
      conversations: {
        $get: async () => Response.json([conversation]),
        $post: async () => Response.json(conversation),
        ":conversationId": {
          ...messageActions,
          $get: async () => Response.json({ conversation, messages: [priorAssistant], activeTurn: null, pendingActions: [] }),
          turns: {
            $post: async () => sse([]),
            ":turnId": {
              abort: {
                $post: async () => Response.json({ ok: true }),
              },
              actions: {
                ":callId": {
                  $post: async () => Response.json({ ok: true }),
                },
              },
              events: {
                $get: async () =>
                  sse([
                    {
                      type: "done",
                      conversationId: conversation.id,
                      turnId: "turn-zero",
                      reason: "error",
                      aggregate: zeroTurnAggregate,
                      cursor: "1-0",
                    },
                  ]),
              },
            },
          },
        },
      },
    };

    await createRoot(async (dispose) => {
      const chat = createAiChatController({
        route,
        initialConversations: [conversation],
        initialConversationId: conversation.id,
        initialMessages: [priorAssistant],
        autoResume: false,
      });

      await chat.resume({ conversationId: conversation.id, turnId: "turn-zero" });
      expect(chat.messages()).toEqual([priorAssistant]);
      dispose();
    });
  });

  test("shows thinking deltas before text and preserves final assistant blocks", async () => {
    const finalMessage = {
      role: "assistant" as const,
      content: [
        { type: "thinking" as const, thinking: "thinking now" },
        { type: "text" as const, text: "final answer" },
      ],
    };
    const assistantMessage = {
      id: "message-thinking",
      conversationId: conversation.id,
      seq: 2,
      kind: "message" as const,
      message: finalMessage,
      modelProfileId: "model-1",
      providerModel: "provider/model",
      usage: null,
      stopReason: "stop",
      ...noLoopMetadata,
      createdAt: new Date().toISOString(),
    };
    let releaseRefresh: (() => void) | undefined;
    const refreshGate = new Promise<Response>((resolve) => {
      releaseRefresh = () => resolve(Response.json({ conversation, messages: [assistantMessage], activeTurn: null, pendingActions: [] }));
    });
    const route = {
      conversations: {
        $get: async () => Response.json([conversation]),
        $post: async () => Response.json(conversation),
        ":conversationId": {
          ...messageActions,
          $get: async () => refreshGate,
          turns: {
            $post: async () =>
              new Response(
                new ReadableStream<Uint8Array>({
                  async start(controller) {
                    controller.enqueue(
                      encoder.encode(
                        `event: message\ndata: ${JSON.stringify({
                          type: "turn_start",
                          conversationId: conversation.id,
                          turnId: "turn-1",
                          modelProfileId: "model-1",
                          providerModel: "provider/model",
                          cursor: "1-0",
                        })}\n\n`,
                      ),
                    );
                    controller.enqueue(
                      encoder.encode(
                        `event: message\ndata: ${JSON.stringify({
                          type: "nessi",
                          conversationId: conversation.id,
                          turnId: "turn-1",
                          event: { type: "thinking", agentId: "cloud", delta: "thinking now" },
                          cursor: "2-0",
                        })}\n\n`,
                      ),
                    );
                    await new Promise((resolve) => setTimeout(resolve, 60));
                    for (const event of [
                      {
                        type: "nessi",
                        conversationId: conversation.id,
                        turnId: "turn-1",
                        event: { type: "text", agentId: "cloud", delta: "final answer" },
                        cursor: "3-0",
                      },
                      {
                        type: "nessi",
                        conversationId: conversation.id,
                        turnId: "turn-1",
                        event: {
                          type: "turn_end",
                          agentId: "cloud",
                          message: finalMessage,
                        },
                        cursor: "4-0",
                      },
                      { type: "done", conversationId: conversation.id, turnId: "turn-1", reason: "stop", aggregate: null, cursor: "5-0" },
                    ]) {
                      controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(event)}\n\n`));
                    }
                    controller.close();
                  },
                }),
              ),
            ":turnId": {
              abort: {
                $post: async () => Response.json({ ok: true }),
              },
              actions: {
                ":callId": {
                  $post: async () => Response.json({ ok: true }),
                },
              },
              events: {
                $get: async () => sse([]),
              },
            },
          },
        },
      },
    };

    await createRoot(async (dispose) => {
      const chat = createAiChatController({
        route,
        initialConversations: [conversation],
        initialConversationId: conversation.id,
        autoResume: false,
      });

      const sendPromise = chat.send({ message: "hello" });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(chat.assistantThinkingDraft()).toBe("thinking now");
      expect(chat.assistantDraft()).toBe("");

      await new Promise((resolve) => setTimeout(resolve, 140));
      expect(chat.assistantThinkingDraft()).toBe("");
      expect(chat.messages().at(-1)?.message).toEqual(finalMessage);

      releaseRefresh?.();
      await sendPromise;
      expect(chat.messages().at(-1)?.message).toEqual(finalMessage);
      dispose();
    });
  });

  test("bounds large burst drain time before resolving a completed send", async () => {
    const answer = "x".repeat(20_000);
    const assistantMessage = {
      id: "message-large",
      conversationId: conversation.id,
      seq: 2,
      kind: "message" as const,
      message: { role: "assistant" as const, content: [{ type: "text" as const, text: answer }] },
      modelProfileId: "model-1",
      providerModel: "provider/model",
      usage: null,
      stopReason: "stop",
      ...noLoopMetadata,
      createdAt: new Date().toISOString(),
    };
    const route = {
      conversations: {
        $get: async () => Response.json([conversation]),
        $post: async () => Response.json(conversation),
        ":conversationId": {
          ...messageActions,
          $get: async () => Response.json({ conversation, messages: [assistantMessage], activeTurn: null, pendingActions: [] }),
          turns: {
            $post: async () =>
              sse([
                {
                  type: "turn_start",
                  conversationId: conversation.id,
                  turnId: "turn-1",
                  modelProfileId: "model-1",
                  providerModel: "provider/model",
                  cursor: "1-0",
                },
                {
                  type: "nessi",
                  conversationId: conversation.id,
                  turnId: "turn-1",
                  event: { type: "text", agentId: "cloud", delta: answer },
                  cursor: "2-0",
                },
                {
                  type: "nessi",
                  conversationId: conversation.id,
                  turnId: "turn-1",
                  event: {
                    type: "turn_end",
                    agentId: "cloud",
                    message: { role: "assistant", content: [{ type: "text", text: answer }] },
                  },
                  cursor: "3-0",
                },
                { type: "done", conversationId: conversation.id, turnId: "turn-1", reason: "stop", aggregate: null, cursor: "4-0" },
              ]),
            ":turnId": {
              abort: {
                $post: async () => Response.json({ ok: true }),
              },
              actions: {
                ":callId": {
                  $post: async () => Response.json({ ok: true }),
                },
              },
              events: {
                $get: async () => sse([]),
              },
            },
          },
        },
      },
    };

    await createRoot(async (dispose) => {
      const chat = createAiChatController({
        route,
        initialConversations: [conversation],
        initialConversationId: conversation.id,
        autoResume: false,
      });

      const started = performance.now();
      await chat.send({ message: "hello" });
      expect(performance.now() - started).toBeLessThan(5_000);
      expect(chat.assistantDraft()).toBe("");
      expect(chat.messages().at(-1)?.message).toEqual({ role: "assistant", content: [{ type: "text", text: answer }] });
      dispose();
    });
  });

  test("commits an earlier turn_end before streaming the next assistant segment", async () => {
    const route = {
      conversations: {
        $get: async () => Response.json([conversation]),
        $post: async () => Response.json(conversation),
        ":conversationId": {
          ...messageActions,
          $get: async () =>
            Response.json({
              conversation,
              messages: [],
              activeTurn: {
                id: "turn-1",
                conversationId: conversation.id,
                status: "running",
                modelProfileId: "model-1",
                createdAt: new Date().toISOString(),
                completedAt: null,
                error: null,
              },
              pendingActions: [],
            }),
          turns: {
            $post: async () =>
              new Response(
                new ReadableStream<Uint8Array>({
                  async start(controller) {
                    for (const event of [
                      {
                        type: "turn_start",
                        conversationId: conversation.id,
                        turnId: "turn-1",
                        modelProfileId: "model-1",
                        providerModel: "provider/model",
                        cursor: "1-0",
                      },
                      {
                        type: "nessi",
                        conversationId: conversation.id,
                        turnId: "turn-1",
                        event: { type: "text", agentId: "cloud", delta: "first answer" },
                        cursor: "2-0",
                      },
                      {
                        type: "nessi",
                        conversationId: conversation.id,
                        turnId: "turn-1",
                        event: {
                          type: "turn_end",
                          agentId: "cloud",
                          message: { role: "assistant", content: [{ type: "text", text: "first answer" }] },
                        },
                        cursor: "3-0",
                      },
                      {
                        type: "nessi",
                        conversationId: conversation.id,
                        turnId: "turn-1",
                        event: { type: "text", agentId: "cloud", delta: "second answer" },
                        cursor: "4-0",
                      },
                    ]) {
                      controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(event)}\n\n`));
                    }
                    await new Promise((resolve) => setTimeout(resolve, 80));
                    controller.close();
                  },
                }),
              ),
            ":turnId": {
              abort: {
                $post: async () => Response.json({ ok: true }),
              },
              actions: {
                ":callId": {
                  $post: async () => Response.json({ ok: true }),
                },
              },
              events: {
                $get: async () => sse([]),
              },
            },
          },
        },
      },
    };

    await createRoot(async (dispose) => {
      const chat = createAiChatController({
        route,
        initialConversations: [conversation],
        initialConversationId: conversation.id,
        autoResume: false,
      });

      const sendPromise = chat.send({ message: "hello" });
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(chat.messages().some((entry) => entry.message.role === "assistant")).toBe(true);
      expect(chat.messages().find((entry) => entry.message.role === "assistant")?.message).toEqual({
        role: "assistant",
        content: [{ type: "text", text: "first answer" }],
      });

      await sendPromise;
      dispose();
    });
  });

  test("runs registered client frontend tools and posts the result back to the turn", async () => {
    let postedAction: unknown;
    let resolvePostedAction: (() => void) | undefined;
    const postedActionPromise = new Promise<void>((resolve) => {
      resolvePostedAction = resolve;
    });

    const route = {
      conversations: {
        $get: async () => Response.json([conversation]),
        $post: async () => Response.json(conversation),
        ":conversationId": {
          ...messageActions,
          $get: async () => Response.json({ conversation, messages: [], activeTurn: null }),
          turns: {
            $post: async () =>
              sse([
                {
                  type: "turn_start",
                  conversationId: conversation.id,
                  turnId: "turn-1",
                  modelProfileId: "model-1",
                  providerModel: "provider/model",
                  cursor: "1-0",
                },
                {
                  type: "frontend_tool",
                  conversationId: conversation.id,
                  turnId: "turn-1",
                  callId: "call-1",
                  name: "survey",
                  mode: "client",
                  args: { question: "Ready?" },
                  cursor: "2-0",
                },
                { type: "done", conversationId: conversation.id, turnId: "turn-1", reason: "stop", aggregate: null, cursor: "3-0" },
              ]),
            ":turnId": {
              abort: {
                $post: async () => Response.json({ ok: true }),
              },
              actions: {
                ":callId": {
                  $post: async (input: { json: unknown }) => {
                    postedAction = input.json;
                    resolvePostedAction?.();
                    return Response.json({ ok: true });
                  },
                },
              },
              events: {
                $get: async () => sse([{ type: "done", conversationId: conversation.id, turnId: "turn-1", reason: "stop", aggregate: null }]),
              },
            },
          },
        },
      },
    };

    await createRoot(async (dispose) => {
      const chat = createAiChatController({
        route,
        initialConversations: [conversation],
        initialConversationId: conversation.id,
        frontendTools: {
          survey: async (request) => ({ answer: `yes:${(request.args as { question: string }).question}` }),
        },
      });

      await chat.send({ message: "run the survey" });
      await postedActionPromise;
      dispose();
    });

    expect(postedAction).toEqual({
      type: "tool_result",
      result: { answer: "yes:Ready?" },
    });
  });
});
