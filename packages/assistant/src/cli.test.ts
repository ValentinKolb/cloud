import { describe, expect, test } from "bun:test";
import type { CloudCliContext } from "@valentinkolb/cloud/cli";
import assistantCli from "./cli";

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
    expect(help).toContain("ask");
    expect(help).toContain("chats");
    expect(help).toContain("actions");
    expect(help).toContain("files");
    expect(help).toContain("prefs");
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
    const { ctx, stdout, stderr } = createContext(["ask", "hello"], async (path, init) => {
      requests.push(`${init?.method ?? "GET"} ${String(path)}`);
      if (path === "/api/assistant/conversations") return json({ id: "chat-1", title: "New chat" }, 201);
      if (path === "/api/assistant/conversations/chat-1/stream") return stream;
      if (path === "/api/assistant/conversations/chat-1/turns") return json({ turn: { id: "turn-1", status: "queued" } }, 201);
      return json({ message: "Not found" }, 404);
    });

    expect(await assistantCli.run(ctx)).toBe(0);
    expect(stdout.join("")).toBe("Hello\n");
    expect(stderr).toEqual([]);
    expect(requests).toEqual([
      "POST /api/assistant/conversations",
      "GET /api/assistant/conversations/chat-1/stream",
      "POST /api/assistant/conversations/chat-1/turns",
    ]);
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
    const { ctx } = createContext(["ask", "Summarize this"], async (path, init) => {
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
