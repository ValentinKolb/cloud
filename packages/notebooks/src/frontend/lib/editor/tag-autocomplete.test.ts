import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { beforeEach, expect, test } from "bun:test";
import { buildTagCompletionSource } from "./tag-autocomplete";

const mockTags = (tags: Array<{ tag: string; count: number }>) => {
  globalThis.fetch = Object.assign(
    async () =>
      new Response(JSON.stringify(tags), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    { preconnect: () => {} },
  ) as typeof fetch;
};

const complete = async (notebookId: string, doc: string, explicit = false) => {
  const source = buildTagCompletionSource(notebookId);
  const state = EditorState.create({ doc });
  const result = await source(new CompletionContext(state, doc.length, explicit));
  return result?.options.map((option) => option.label) ?? [];
};

beforeEach(() => {
  mockTags([]);
});

test("suggests server-indexed tags after typing a tag prefix", async () => {
  mockTags([
    { tag: "todo", count: 3 },
    { tag: "travel", count: 1 },
  ]);

  await expect(complete("tag-server-test", "#t")).resolves.toEqual(["todo", "travel"]);
});

test("uses tags from the current document before the server index catches up", async () => {
  mockTags([]);

  await expect(complete("tag-local-test", "#daily\n\nPlanning #t")).resolves.toEqual(["daily"]);
});

test("does not suggest the active partial tag as a local tag", async () => {
  mockTags([]);

  await expect(complete("tag-active-word-test", "#t")).resolves.toEqual([]);
});
