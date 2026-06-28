import { describe, expect, test } from "bun:test";
import { createRoot } from "solid-js";
import { createAiChatController } from "./solid";
import type { AiConversation } from "./types";

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
  resource: { kind: "direct" },
  createdByUserId: "11111111-1111-4111-8111-111111111111",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("AI Solid chat controller", () => {
  test("does not abort a detached server turn when the controller is disposed", () => {
    let abortCalls = 0;
    const route = {
      conversations: {
        $get: async () => Response.json([conversation]),
        $post: async () => Response.json(conversation),
        ":conversationId": {
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

  test("keeps initial pending approval requests available without replay", () => {
    const route = {
      conversations: {
        $get: async () => Response.json([conversation]),
        $post: async () => Response.json(conversation),
        ":conversationId": {
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
                { type: "done", conversationId: conversation.id, turnId: "turn-1", reason: "stop", cursor: "3-0" },
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
                $get: async () => sse([{ type: "done", conversationId: conversation.id, turnId: "turn-1", reason: "stop" }]),
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
