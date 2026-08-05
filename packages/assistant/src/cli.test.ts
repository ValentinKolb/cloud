import { describe, expect, test } from "bun:test";
import type { CloudCliContext } from "@valentinkolb/cloud/cli";
import assistantCli from "./cli";
import { collectSurveyResult, runInteractiveAssistant } from "./cli/interactive";
import { streamAssistantTurn } from "./cli/stream";

const json = (value: unknown, status = 200) => Response.json(value, { status });

const sse = (...events: unknown[]) =>
  new Response(events.map((event) => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });

const createContext = (args: string[], fetcher: CloudCliContext["fetch"]): { ctx: CloudCliContext; stdout: string[]; stderr: string[] } => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const ctx: CloudCliContext = {
    args,
    flags: {},
    options: { profile: "test", server: "https://cloud.example", token: "test", output: "text" },
    getDefault: async () => undefined,
    setDefault: async () => undefined,
    createApiClient: () => {
      throw new Error("unused");
    },
    fetch: fetcher,
    readJson: async <T>(response: Response) => {
      if (!response.ok)
        throw new Error(`${response.status} ${((await response.json()) as { message?: string }).message ?? response.statusText}`);
      return (await response.json()) as T;
    },
    print: (value = "") => stdout.push(`${value}\n`),
    write: async (value) => void stdout.push(value),
    error: (value) => stderr.push(value),
    json: (value) => stdout.push(`${JSON.stringify(value)}\n`),
    jsonLine: (value) => stdout.push(`${JSON.stringify(value)}\n`),
    table: () => undefined,
  };
  return { ctx, stdout, stderr };
};

describe("assistant CLI", () => {
  test("documents the one-shot and management surface", () => {
    const help = assistantCli.help?.() ?? "";
    expect(help).toContain("cld assistant -p");
    expect(help).not.toContain(" ask ");
    expect(help).toContain("chats");
    expect(help).toContain("actions");
    expect(help).toContain("files");
    expect(help).toContain("prefs");
    expect(help).toContain("Create, inspect, and manage Assistant chats");
    expect(help).toContain("Review and resolve pending turn actions");
    expect(help).not.toMatch(/^\s+\w+\s+Commands$/m);
  });

  test("creates a chat and writes only streamed assistant text to stdout", async () => {
    const requests: string[] = [];
    const stream = sse(
      { type: "state", conversation: { id: "chat-1" }, messages: [], activeTurn: null },
      {
        v: 1,
        type: "turn_started",
        conversationId: "chat-1",
        turnId: "turn-1",
        attempt: 1,
        seq: 1,
        modelProfileId: "model-1",
        providerModel: "provider/model",
      },
      {
        v: 1,
        type: "block_delta",
        conversationId: "chat-1",
        turnId: "turn-1",
        attempt: 1,
        seq: 2,
        blockId: "text-1",
        blockKind: "text",
        delta: "Hello",
      },
      {
        v: 1,
        type: "turn_finished",
        conversationId: "chat-1",
        turnId: "turn-1",
        attempt: 1,
        seq: 3,
        status: "completed",
        error: null,
        messages: [
          {
            id: "message-1",
            loopId: "turn-1",
            kind: "message",
            message: { role: "assistant", content: [{ type: "text", text: "Hello" }] },
          },
        ],
      },
    );
    const { ctx, stdout, stderr } = createContext(["hello"], async (path, init) => {
      requests.push(`${init?.method ?? "GET"} ${String(path)}`);
      if (path === "/api/assistant/conversations") return json({ id: "chat-1", title: "New chat" }, 201);
      if (path === "/api/assistant/conversations/chat-1/stream") return stream;
      if (path === "/api/assistant/conversations/chat-1/turns") return json({ turn: { id: "turn-1", status: "queued" } }, 201);
      return json({ message: "Not found" }, 404);
    });
    ctx.flags.print = true;

    expect(await assistantCli.run(ctx)).toBe(0);
    expect(stdout.join("")).toBe("Hello\n");
    expect(stderr).toEqual([]);
    expect(requests).toEqual([
      "POST /api/assistant/conversations",
      "GET /api/assistant/conversations/chat-1/stream",
      "POST /api/assistant/conversations/chat-1/turns",
    ]);
  });

  test("keeps one conversation across interactive messages", async () => {
    let streamIndex = 0;
    let turnIndex = 0;
    const requests: string[] = [];
    const streams = [
      sse(
        { type: "state", conversation: { id: "chat-1" }, messages: [], activeTurn: null },
        {
          v: 1,
          type: "block_delta",
          conversationId: "chat-1",
          turnId: "turn-1",
          attempt: 1,
          seq: 1,
          blockId: "text-1",
          blockKind: "text",
          delta: "First",
        },
        {
          v: 1,
          type: "turn_finished",
          conversationId: "chat-1",
          turnId: "turn-1",
          attempt: 1,
          seq: 2,
          status: "completed",
          error: null,
          messages: [],
        },
      ),
      sse(
        { type: "state", conversation: { id: "chat-1" }, messages: [], activeTurn: null },
        {
          v: 1,
          type: "block_delta",
          conversationId: "chat-1",
          turnId: "turn-2",
          attempt: 1,
          seq: 1,
          blockId: "text-2",
          blockKind: "text",
          delta: "Second",
        },
        {
          v: 1,
          type: "turn_finished",
          conversationId: "chat-1",
          turnId: "turn-2",
          attempt: 1,
          seq: 2,
          status: "completed",
          error: null,
          messages: [],
        },
      ),
    ];
    const { ctx, stdout, stderr } = createContext([], async (path, init) => {
      requests.push(`${init?.method ?? "GET"} ${String(path)}`);
      if (path === "/api/assistant/conversations") return json({ id: "chat-1", title: "New chat" }, 201);
      if (path === "/api/assistant/conversations/chat-1/stream") return streams[streamIndex++]!;
      if (path === "/api/assistant/conversations/chat-1/turns") {
        turnIndex += 1;
        return json({ turn: { id: `turn-${turnIndex}`, status: "queued" } }, 201);
      }
      return json({ message: "Not found" }, 404);
    });
    const lines = ["hello", "again", "/exit"];
    const prompts: string[] = [];
    const reader = {
      read: async (prompt: string) => {
        prompts.push(prompt);
        return lines.shift() ?? null;
      },
      close: () => undefined,
      onInterrupt: () => () => undefined,
    };

    expect(await runInteractiveAssistant(ctx, {}, reader)).toBe(0);
    const output = stdout.join("");
    expect(output).toContain("\u001b[34mInfo:\u001b[0m New chat created. Resume this chat later with:\n      cld assistant --chat chat-1");
    expect(output).toContain("\u001b[34mInfo:\u001b[0m Resume this chat later with:\n      cld assistant --chat chat-1");
    expect(output.match(/cld assistant --chat chat-1/g)).toHaveLength(2);
    expect(output).toContain("First\nSecond\n");
    expect(stderr).not.toContain("Chat: chat-1");
    expect(prompts).toEqual(["> ", "> ", "> "]);
    expect(requests.filter((request) => request === "POST /api/assistant/conversations")).toHaveLength(1);
    expect(requests.filter((request) => request === "POST /api/assistant/conversations/chat-1/turns")).toHaveLength(2);
  });

  test("selects a model and next-message skill through numbered pickers", async () => {
    const skillId = "11111111-1111-4111-8111-111111111111";
    const turnBodies: unknown[] = [];
    let streamIndex = 0;
    let turnIndex = 0;
    const streams = ["turn-1", "turn-2"].map((turnId) =>
      sse(
        { type: "state", conversation: { id: "chat-1" }, messages: [], activeTurn: null },
        {
          v: 1,
          type: "turn_finished",
          conversationId: "chat-1",
          turnId,
          attempt: 1,
          seq: 1,
          status: "completed",
          error: null,
          messages: [],
        },
      ),
    );
    const { ctx, stdout } = createContext([], async (path, init) => {
      if (path === "/api/assistant/status") {
        return json({
          defaultModelId: "model-1",
          models: [
            { id: "model-1", label: "Model One", provider: "provider", model: "one", capabilities: [] },
            { id: "model-2", label: "Model Two", provider: "provider", model: "two", capabilities: [] },
          ],
        });
      }
      if (path === "/api/assistant/models") {
        return json([
          { id: "model-1", label: "Model One", provider: "provider", model: "one", capabilities: [] },
          { id: "model-2", label: "Model Two", provider: "provider", model: "two", capabilities: [] },
        ]);
      }
      if (path === "/api/ai/skills/") {
        return json({
          skills: [
            {
              id: skillId,
              name: "Release notes",
              description: "Summarize releases",
              scope: "personal",
              ownerUserId: "22222222-2222-4222-8222-222222222222",
              enabled: true,
              revision: 1,
              createdAt: "2026-08-04T00:00:00.000Z",
              updatedAt: "2026-08-04T00:00:00.000Z",
            },
          ],
        });
      }
      if (path === "/api/assistant/conversations") return json({ id: "chat-1", title: "New chat" }, 201);
      if (path === "/api/assistant/conversations/chat-1/stream") return streams[streamIndex++]!;
      if (path === "/api/assistant/conversations/chat-1/turns") {
        turnBodies.push(init?.body ? JSON.parse(String(init.body)) : null);
        turnIndex += 1;
        return json({ turn: { id: `turn-${turnIndex}`, status: "queued" } }, 201);
      }
      return json({ message: "Not found" }, 404);
    });
    const lines = ["/model", "2", "/skill", "1", "Summarize this", "Continue", "/exit"];
    const reader = {
      read: async () => lines.shift() ?? null,
      close: () => undefined,
      onInterrupt: () => () => undefined,
    };

    expect(await runInteractiveAssistant(ctx, {}, reader)).toBe(0);
    expect(turnBodies).toEqual([
      { message: "Summarize this", modelProfileId: "model-2", skillId },
      { message: "Continue", modelProfileId: "model-2" },
    ]);
    const output = stdout.join("");
    expect(output).toContain("Assistant · Model One · /help for commands");
    expect(output).toContain("Select a model:");
    expect(output).toContain("2. Model Two · provider · two");
    expect(output).toContain("Select a skill for the next message:");
    expect(output).toContain("1. Release notes · personal · Summarize releases");
  });

  test("recognizes an approval already present in the initial stream state", async () => {
    const { ctx } = createContext([], async () => json({ message: "unused" }, 500));
    const initialResponse = sse({
      type: "state",
      conversation: { id: "chat-1" },
      messages: [],
      activeTurn: {
        turnId: "turn-1",
        attempt: 1,
        status: "waiting_for_action",
        blocks: [
          {
            id: "tool-1",
            kind: "tool",
            callId: "call-1",
            name: "mail.createDraft",
            args: { subject: "Hello" },
            status: "awaiting_approval",
            approval: { allowAlways: false },
          },
        ],
      },
    });

    const result = await streamAssistantTurn({ ctx, conversationId: "chat-1", turnId: "turn-1", initialResponse });
    expect(result.status).toBe("needs_attention");
    expect(result.pending).toEqual({ type: "approval", callId: "call-1", name: "mail.createDraft" });
  });

  test("resolves an approval inline and resumes the same turn", async () => {
    let streamIndex = 0;
    let approvalBody: unknown;
    const streams = [
      sse(
        { type: "state", conversation: { id: "chat-1" }, messages: [], activeTurn: null },
        {
          v: 1,
          type: "block_set",
          conversationId: "chat-1",
          turnId: "turn-1",
          attempt: 1,
          seq: 1,
          block: {
            id: "tool-1",
            kind: "tool",
            callId: "call-1",
            name: "mail.createDraft",
            args: { subject: "Hello" },
            status: "awaiting_approval",
            approval: { allowAlways: false },
          },
        },
      ),
      sse(
        {
          v: 1,
          type: "block_delta",
          conversationId: "chat-1",
          turnId: "turn-1",
          attempt: 1,
          seq: 2,
          blockId: "text-1",
          blockKind: "text",
          delta: "Done",
        },
        {
          v: 1,
          type: "turn_finished",
          conversationId: "chat-1",
          turnId: "turn-1",
          attempt: 1,
          seq: 3,
          status: "completed",
          error: null,
          messages: [],
        },
      ),
    ];
    const { ctx, stdout } = createContext([], async (path, init) => {
      if (path === "/api/assistant/conversations") return json({ id: "chat-1", title: "New chat" }, 201);
      if (path === "/api/assistant/conversations/chat-1/stream") return streams[streamIndex++]!;
      if (path === "/api/assistant/conversations/chat-1/turns") {
        return json({ turn: { id: "turn-1", status: "queued" } }, 201);
      }
      if (path === "/api/assistant/conversations/chat-1/pending-actions/turn-1") {
        return json([
          {
            type: "approval_request",
            conversationId: "chat-1",
            turnId: "turn-1",
            callId: "call-1",
            name: "mail.createDraft",
            args: { subject: "Hello" },
            message: "Create draft",
            allowAlways: false,
          },
        ]);
      }
      if (path === "/api/assistant/conversations/chat-1/turns/turn-1/actions/call-1") {
        approvalBody = JSON.parse(String(init?.body));
        return json({ ok: true });
      }
      return json({ message: "Not found" }, 404);
    });
    const lines = ["hello", "y", "/exit"];
    const reader = {
      read: async () => lines.shift() ?? null,
      close: () => undefined,
      onInterrupt: () => () => undefined,
    };

    expect(await runInteractiveAssistant(ctx, {}, reader)).toBe(0);
    expect(approvalBody).toEqual({ type: "approval_response", approved: true });
    expect(stdout.join("")).toContain("Done\n");
  });

  test("offers local Bash only for opted-in turns and persists a denial", async () => {
    let streamIndex = 0;
    let turnBody: Record<string, unknown> | undefined;
    let actionBody: unknown;
    const streams = [
      sse(
        { type: "state", conversation: { id: "chat-1" }, messages: [], activeTurn: null },
        {
          v: 1,
          type: "block_set",
          conversationId: "chat-1",
          turnId: "turn-1",
          attempt: 1,
          seq: 1,
          block: {
            id: "tool-1",
            kind: "tool",
            callId: "call-1",
            name: "local_bash",
            args: { command: "touch should-not-exist" },
            status: "awaiting_client",
          },
        },
      ),
      sse(
        {
          v: 1,
          type: "block_delta",
          conversationId: "chat-1",
          turnId: "turn-1",
          attempt: 1,
          seq: 2,
          blockId: "text-1",
          blockKind: "text",
          delta: "Command was not run.",
        },
        {
          v: 1,
          type: "turn_finished",
          conversationId: "chat-1",
          turnId: "turn-1",
          attempt: 1,
          seq: 3,
          status: "completed",
          error: null,
          messages: [],
        },
      ),
    ];
    const { ctx, stdout, stderr } = createContext([], async (path, init) => {
      if (path === "/api/assistant/conversations") return json({ id: "chat-1", title: "New chat" }, 201);
      if (path === "/api/assistant/conversations/chat-1/stream") return streams[streamIndex++]!;
      if (path === "/api/assistant/conversations/chat-1/turns") {
        turnBody = JSON.parse(String(init?.body));
        return json({ turn: { id: "turn-1", status: "queued" } }, 201);
      }
      if (path === "/api/assistant/conversations/chat-1/pending-actions/turn-1") {
        return json([
          {
            type: "frontend_tool",
            conversationId: "chat-1",
            turnId: "turn-1",
            callId: "call-1",
            name: "local_bash",
            args: { command: "touch should-not-exist" },
            mode: "client",
          },
        ]);
      }
      if (path === "/api/assistant/conversations/chat-1/turns/turn-1/actions/call-1") {
        actionBody = JSON.parse(String(init?.body));
        return json({ ok: true });
      }
      return json({ message: "Not found" }, 404);
    });
    const lines = ["inspect this checkout", "", "/exit"];
    const reader = {
      read: async () => lines.shift() ?? null,
      close: () => undefined,
      onInterrupt: () => () => undefined,
    };

    expect(await runInteractiveAssistant(ctx, { allowBash: true }, reader)).toBe(0);
    expect(turnBody?.clientToolIds).toEqual(["local_bash"]);
    expect(actionBody).toEqual({
      type: "tool_result",
      result: {
        status: "denied",
        exitCode: null,
        stdout: "",
        stderr: "User denied this command.",
        truncated: false,
      },
    });
    expect(stdout.join("")).toContain("Command was not run.");
    expect(stderr.join("\n")).toContain("Bash wants to run");
  });

  test("resumes a pending local Bash call without submitting a new turn", async () => {
    let streamIndex = 0;
    let actionBody: unknown;
    let submittedTurns = 0;
    const streams = [
      sse({
        type: "state",
        conversation: { id: "chat-1" },
        messages: [],
        activeTurn: {
          turnId: "turn-1",
          attempt: 1,
          status: "waiting_for_action",
          blocks: [
            {
              id: "tool-1",
              kind: "tool",
              callId: "call-1",
              name: "local_bash",
              args: { command: "touch should-not-exist" },
              status: "awaiting_client",
            },
          ],
        },
      }),
      sse(
        {
          v: 1,
          type: "block_delta",
          conversationId: "chat-1",
          turnId: "turn-1",
          attempt: 2,
          seq: 2,
          blockId: "text-1",
          blockKind: "text",
          delta: "Still safe.",
        },
        {
          v: 1,
          type: "turn_finished",
          conversationId: "chat-1",
          turnId: "turn-1",
          attempt: 2,
          seq: 3,
          status: "completed",
          error: null,
          messages: [],
        },
      ),
    ];
    const { ctx, stdout } = createContext([], async (path, init) => {
      if (path === "/api/assistant/conversations/chat-1") {
        return json({ conversation: { id: "chat-1", title: "Existing" }, activeTurn: { turnId: "turn-1", status: "waiting_for_action" } });
      }
      if (path === "/api/assistant/conversations/chat-1/stream") return streams[streamIndex++]!;
      if (path === "/api/assistant/conversations/chat-1/pending-actions/turn-1") {
        return json([
          {
            type: "frontend_tool",
            conversationId: "chat-1",
            turnId: "turn-1",
            callId: "call-1",
            name: "local_bash",
            args: { command: "touch should-not-exist" },
            mode: "client",
          },
        ]);
      }
      if (path === "/api/assistant/conversations/chat-1/turns/turn-1/actions/call-1") {
        actionBody = JSON.parse(String(init?.body));
        return json({ ok: true });
      }
      if (path === "/api/assistant/conversations/chat-1/turns") {
        submittedTurns += 1;
        return json({ turn: { id: "unexpected", status: "queued" } }, 201);
      }
      return json({ message: "Not found" }, 404);
    });
    const lines = ["n", "/exit"];
    const reader = {
      read: async () => lines.shift() ?? null,
      close: () => undefined,
      onInterrupt: () => () => undefined,
    };

    expect(await runInteractiveAssistant(ctx, { conversationId: "chat-1", allowBash: true }, reader)).toBe(0);
    expect(submittedTurns).toBe(0);
    expect(actionBody).toMatchObject({ type: "tool_result", result: { status: "denied" } });
    expect(stdout.join("")).toContain("Still safe.");
  });

  test("collects the built-in survey with terminal-native answers", async () => {
    const { ctx } = createContext([], async () => json({}));
    const lines = ["2", "1,3", "Looks good", "4"];
    const reader = {
      read: async () => lines.shift() ?? null,
      close: () => undefined,
      onInterrupt: () => () => undefined,
    };

    const result = await collectSurveyResult(ctx, reader, {
      title: "Review",
      questions: [
        {
          type: "single",
          id: "priority",
          label: "Priority",
          required: true,
          options: [
            { value: "low", label: "Low" },
            { value: "high", label: "High" },
          ],
        },
        {
          type: "multiple",
          id: "areas",
          label: "Areas",
          required: true,
          options: [
            { value: "api", label: "API" },
            { value: "ui", label: "UI" },
            { value: "docs", label: "Docs" },
          ],
        },
        { type: "text", id: "note", label: "Note" },
        { type: "rating", id: "rating", label: "Rating", min: 1, max: 5, required: true },
      ],
    });

    expect(result).toEqual({
      submitted: true,
      answers: { priority: "high", areas: ["api", "docs"], note: "Looks good", rating: 4 },
    });
  });

  test("creates a text-only personal skill", async () => {
    const requests: Array<{ path: string; method: string; body: unknown }> = [];
    const { ctx, stdout } = createContext(["skills", "create", "Release notes"], async (path, init) => {
      requests.push({ path: String(path), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
      return json({
        skill: {
          id: "11111111-1111-4111-8111-111111111111",
          name: "Release notes",
          description: "Summarize releases",
          instructions: "List user-visible changes.",
          scope: "personal",
          ownerUserId: "22222222-2222-4222-8222-222222222222",
          enabled: true,
          revision: 1,
          createdAt: "2026-08-04T00:00:00.000Z",
          updatedAt: "2026-08-04T00:00:00.000Z",
        },
      });
    });
    ctx.flags.description = "Summarize releases";
    ctx.flags.instructions = "List user-visible changes.";

    expect(await assistantCli.run(ctx)).toBeUndefined();
    expect(requests).toEqual([
      {
        path: "/api/ai/skills/",
        method: "POST",
        body: {
          name: "Release notes",
          description: "Summarize releases",
          instructions: "List user-visible changes.",
        },
      },
    ]);
    expect(stdout.join("")).toContain("Release notes");
  });

  test("resolves a selected skill for a detached chat turn", async () => {
    const skillId = "11111111-1111-4111-8111-111111111111";
    const requests: Array<{ path: string; method: string; body: unknown }> = [];
    const { ctx } = createContext(["Summarize this"], async (path, init) => {
      requests.push({ path: String(path), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
      if (path === "/api/assistant/conversations/chat-1") {
        return json({ conversation: { id: "chat-1", title: "Existing chat" } });
      }
      if (path === "/api/ai/skills/") {
        return json({
          skills: [
            {
              id: skillId,
              name: "Release notes",
              description: "Summarize releases",
              scope: "personal",
              enabled: true,
              revision: 1,
              updatedAt: "2026-08-04T00:00:00.000Z",
            },
          ],
        });
      }
      if (path === "/api/assistant/conversations/chat-1/turns") {
        return json({ turn: { id: "turn-1", status: "queued" } }, 201);
      }
      return json({ message: "Not found" }, 404);
    });
    ctx.flags.chat = "chat-1";
    ctx.flags.skill = "Release notes";
    ctx.flags.print = true;
    ctx.flags.detach = true;

    expect(await assistantCli.run(ctx)).toBe(0);
    expect(requests.at(-1)).toEqual({
      path: "/api/assistant/conversations/chat-1/turns",
      method: "POST",
      body: { message: "Summarize this", skillId },
    });
  });

  test("disables workspace skills through the admin catalog", async () => {
    const skillId = "11111111-1111-4111-8111-111111111111";
    const requests: Array<{ path: string; method: string; body: unknown }> = [];
    const { ctx } = createContext(["skills", "disable", "Release notes"], async (path, init) => {
      requests.push({ path: String(path), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
      if (path === "/api/ai/skills/admin") {
        return json({
          skills: [
            {
              id: skillId,
              name: "Release notes",
              description: "Summarize releases",
              scope: "workspace",
              enabled: true,
              revision: 1,
              updatedAt: "2026-08-04T00:00:00.000Z",
            },
          ],
        });
      }
      if (path === `/api/ai/skills/admin/${skillId}`) {
        return json({ skill: { id: skillId, name: "Release notes", enabled: false } });
      }
      return json({ message: "Not found" }, 404);
    });

    expect(await assistantCli.run(ctx)).toBeUndefined();
    expect(requests.at(-1)).toEqual({
      path: `/api/ai/skills/admin/${skillId}`,
      method: "PATCH",
      body: { enabled: false },
    });
  });

  test("applies a selected skill when retrying a message", async () => {
    const skillId = "11111111-1111-4111-8111-111111111111";
    const requests: Array<{ path: string; method: string; body: unknown }> = [];
    const { ctx } = createContext(["messages", "retry", "chat-1", "message-1"], async (path, init) => {
      requests.push({ path: String(path), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
      if (path === `/api/ai/skills/${skillId}`) {
        return json({ skill: { id: skillId, name: "Release notes", scope: "personal", enabled: true } });
      }
      if (path === "/api/assistant/conversations/chat-1/messages/message-1/retry") {
        return json({ turn: { id: "turn-2", status: "queued" } }, 201);
      }
      return json({ message: "Not found" }, 404);
    });
    ctx.flags.skill = skillId;
    ctx.flags.detach = true;

    expect(await assistantCli.run(ctx)).toBe(0);
    expect(requests.at(-1)).toEqual({
      path: "/api/assistant/conversations/chat-1/messages/message-1/retry",
      method: "POST",
      body: { mode: "retry", skillId },
    });
  });
});
