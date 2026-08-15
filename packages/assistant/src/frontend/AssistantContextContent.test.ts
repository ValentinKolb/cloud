import { describe, expect, test } from "bun:test";
import type { FileSource } from "@k2b/ui";
import {
  type AssistantContextFile,
  assistantContextFileSource,
  assistantMarkdownBody,
  isAssistantContextImage,
} from "./AssistantContextContent";

const source = (label: string): FileSource => ({
  list: async () => [],
  read: async (path) => ({ encoding: "utf8", content: `${label}:${path}`, mediaType: "text/plain" }),
  downloadHref: (path) => `/${label}${path}`,
});

describe("Assistant context files", () => {
  test("keeps Project and chat files in one collision-safe read-only browser", async () => {
    const projectSource = source("project");
    const chatSource = source("chat");
    const files = [
      { id: "project-file", path: "/notes.md", mediaType: "text/markdown", size: 20, scope: "project", source: projectSource },
      { id: "chat-file", path: "/notes.md", mediaType: "text/markdown", size: 10, scope: "chat", source: chatSource },
    ] satisfies AssistantContextFile[];
    const combined = assistantContextFileSource(files);

    expect((await combined.list()).map((file) => file.path)).toEqual(["/Project/notes.md", "/Chat/notes.md"]);
    expect(await combined.read("/Project/notes.md")).toEqual({
      encoding: "utf8",
      content: "project:/notes.md",
      mediaType: "text/plain",
    });
    expect(combined.downloadHref?.("/Chat/notes.md")).toBe("/chat/notes.md");
    expect(combined.isReadOnly?.("/Project/notes.md")).toBeTrue();
  });

  test("classifies images separately from regular files", () => {
    const base = { id: "file", path: "/file", size: 10, scope: "chat", source: source("chat") } satisfies Omit<
      AssistantContextFile,
      "mediaType"
    >;
    expect(isAssistantContextImage({ ...base, mediaType: "image/png" })).toBeTrue();
    expect(isAssistantContextImage({ ...base, mediaType: "application/pdf" })).toBeFalse();
  });
});

describe("Assistant context Markdown", () => {
  test("removes only a leading H1 that duplicates the structured title", () => {
    expect(assistantMarkdownBody("Typography and motion", "\n# Typography   and motion\n\nBody copy.")).toBe("Body copy.");
    expect(assistantMarkdownBody("Typography and motion", "# Different heading\n\nBody copy.")).toBe("# Different heading\n\nBody copy.");
    expect(assistantMarkdownBody("Typography and motion", "Body copy.")).toBe("Body copy.");
  });
});
