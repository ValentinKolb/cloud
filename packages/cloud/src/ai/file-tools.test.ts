import { describe, expect, test } from "bun:test";
import {
  createCloudAiListFilesTool,
  createCloudAiReadFileTool,
  createCloudAiWriteFileTool,
  evaluateAiDate,
  evaluateAiMath,
} from "./file-tools";

const projectFiles = {
  list: async () => [
    {
      path: "guides/triage.md",
      mediaType: "text/markdown",
      size: 8,
      updatedAt: "2026-08-15T12:00:00.000Z",
    },
  ],
  read: async (path: string) =>
    path === "guides/triage.md"
      ? {
          path,
          mediaType: "text/markdown",
          size: 8,
          updatedAt: "2026-08-15T12:00:00.000Z",
          bytes: new TextEncoder().encode("# Triage"),
        }
      : null,
};

const toolContext = {
  actor: { kind: "user", user: { id: "user-1" } },
  conversationId: "conversation-1",
  projectFiles,
  signal: new AbortController().signal,
} as never;

describe("AI Project file mount", () => {
  test("lists and reads Project files below the reserved read-only namespace", async () => {
    const list = createCloudAiListFilesTool();
    const read = createCloudAiReadFileTool();
    const write = createCloudAiWriteFileTool();
    if (list.location !== "server" || read.location !== "server" || write.location !== "server") throw new Error("Expected server tools");

    expect(await list.run({ path: "/project" }, toolContext)).toEqual({
      files: [
        {
          path: "/project/guides/triage.md",
          mediaType: "text/markdown",
          size: 8,
          origin: "project",
          updatedAt: "2026-08-15T12:00:00.000Z",
        },
      ],
      truncated: false,
    });
    expect(await read.run({ path: "/project/guides/triage.md", offset: 0, length: 16_384 }, toolContext)).toEqual({
      path: "/project/guides/triage.md",
      mediaType: "text/markdown",
      content: "# Triage",
      offset: 0,
      nextOffset: 8,
      eof: true,
    });
    await expect(write.run({ path: "/project/result.md", content: "No", mode: "overwrite" }, toolContext)).rejects.toThrow(
      "/project namespace is read-only",
    );
  });
});

describe("AI calculate tool", () => {
  test("evaluates arithmetic without executing code", () => {
    expect(evaluateAiMath("2 + 3 * 4")).toBe(14);
    expect(evaluateAiMath("-2 ^ 2")).toBe(-4);
    expect(evaluateAiMath("2 ^ -2")).toBe(0.25);
    expect(evaluateAiMath("round(19.99 * 1.19, 2)")).toBe(23.79);
    expect(evaluateAiMath("1234567890123 + 1")).toBe(1234567890124);
    expect(() => evaluateAiMath("sqrt(4, 9)")).toThrow("expects 1 argument");
    expect(() => evaluateAiMath("round(1.234, 1.5)")).toThrow("round digits");
    expect(() => evaluateAiMath("process.exit()")).toThrow('Unexpected character "."');
    expect(() => evaluateAiMath("1 / 0")).toThrow("not a finite number");
  });

  test("uses deterministic ISO date arithmetic and clamps month ends", () => {
    expect(evaluateAiDate("2026-01-31 + 1 month")).toBe("2026-02-28");
    expect(evaluateAiDate("2024-02-29 + 1 year")).toBe("2025-02-28");
    expect(evaluateAiDate("2026-03-01 - 2 weeks")).toBe("2026-02-15");
    expect(() => evaluateAiDate("03/01/2026 + 1 day")).toThrow("ISO date");
  });
});
