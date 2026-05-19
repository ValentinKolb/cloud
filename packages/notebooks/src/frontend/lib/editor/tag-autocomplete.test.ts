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

const completeWithDuration = async (notebookId: string, doc: string) => {
  const startedAt = performance.now();
  const labels = await complete(notebookId, doc);
  return { labels, durationMs: performance.now() - startedAt };
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

test("suggests known tags for a bare hash after the delayed path", async () => {
  mockTags([
    { tag: "daily", count: 4 },
    { tag: "garden", count: 2 },
  ]);

  await expect(complete("tag-bare-hash-test", "#")).resolves.toEqual(["daily", "garden"]);
});

test("suggests known tags immediately for an inline bare hash", async () => {
  mockTags([
    { tag: "daily", count: 4 },
    { tag: "garden", count: 2 },
  ]);

  const result = await completeWithDuration("tag-inline-hash-test", "hello #");

  expect(result.labels).toEqual(["daily", "garden"]);
  expect(result.durationMs).toBeLessThan(100);
});

test("explicit bare hash completion stays available for slash command insertion", async () => {
  mockTags([{ tag: "daily", count: 4 }]);

  await expect(complete("tag-explicit-hash-test", "#", true)).resolves.toEqual(["daily"]);
});

test("uses tags from the current document before the server index catches up", async () => {
  mockTags([]);

  await expect(complete("tag-local-test", "#daily\n\nPlanning #t")).resolves.toEqual(["daily"]);
});

test("does not suggest the active partial tag as a local tag", async () => {
  mockTags([]);

  await expect(complete("tag-active-word-test", "#t")).resolves.toEqual([]);
});
