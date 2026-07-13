import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CloudCliContext } from "@valentinkolb/cloud/cli";
import assistantCli from "./cli";

const json = (value: unknown, status = 200) => Response.json(value, { status });

const sse = (...events: unknown[]) =>
  new Response(events.map((event) => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });

const createContext = (
  args: string[],
  fetcher: CloudCliContext["fetch"],
): { ctx: CloudCliContext; stdout: string[]; stderr: string[] } => {
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
      if (!response.ok) throw new Error(`${response.status} ${(await response.json() as { message?: string }).message ?? response.statusText}`);
      return (await response.json()) as T;
    },
    print: (value = "") => stdout.push(`${value}\n`),
    write: (value) => stdout.push(value),
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

  test("skill push dry-run plans creation without mutating the server", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cloud-assistant-skill-"));
    try {
      await writeFile(join(directory, "SKILL.md"), "---\nname: release-notes\ndescription: Summarize releases\n---\n");
      await writeFile(join(directory, "reference.txt"), "Reference\n");
      const requests: string[] = [];
      const { ctx, stdout } = createContext(["skills", "push", directory], async (path, init) => {
        requests.push(`${init?.method ?? "GET"} ${String(path)}`);
        if (path === "/api/ai/skills/managed") return json({ skills: [] });
        return json({ message: "Unexpected request" }, 500);
      });
      ctx.flags["dry-run"] = true;

      expect(await assistantCli.run(ctx)).toBeUndefined();
      expect(requests).toEqual(["GET /api/ai/skills/managed"]);
      expect(stdout.join("")).toContain('"action": "create"');
      expect(stdout.join("")).toContain('"slug": "release-notes"');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("skill pruning requires explicit confirmation", async () => {
    const { ctx } = createContext(["skills", "push", "/unused"], async () => json({ message: "Unexpected request" }, 500));
    ctx.flags.prune = true;
    await expect(assistantCli.run(ctx)).rejects.toThrow("requires --yes");
  });
});
