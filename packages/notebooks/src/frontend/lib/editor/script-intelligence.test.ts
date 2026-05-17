import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, test } from "bun:test";
import { loadScriptIntelligenceTypeFiles } from "../../../../scripts/script-intelligence-type-files";
import { markdownExtension } from "./markdown";
import { __testing, createScriptTypeCompletionSource } from "./script-intelligence";
import { createScriptIntelligenceService } from "./script-intelligence-service";

const stateFor = (doc: string) =>
  EditorState.create({
    doc,
    extensions: [markdownExtension()],
  });

describe("script type intelligence", () => {
  test("detects only script fences", () => {
    const scriptDoc = "```script\nconst value = 1;\nvalue\n```";
    const scriptPos = scriptDoc.indexOf("value\n") + "value".length;
    expect(__testing.findScriptBlock(stateFor(scriptDoc), scriptPos)?.code).toContain("const value");

    const tildeDoc = "~~~script\nconst value = 1;\nvalue\n~~~";
    const tildePos = tildeDoc.indexOf("value\n") + "value".length;
    expect(__testing.findScriptBlock(stateFor(tildeDoc), tildePos)?.code).toContain("const value");

    const jsDoc = "```js\nconst value = 1;\nvalue\n```";
    const jsPos = jsDoc.indexOf("value\n") + "value".length;
    expect(__testing.findScriptBlock(stateFor(jsDoc), jsPos)).toBeNull();
  });

  test("completes local variables and typed kit results", async () => {
    const doc = '```script\nconst notes = await kit.notes.searchTags("garden");\nnotes.\n```';
    const pos = doc.lastIndexOf("notes.") + "notes.".length;
    const source = createScriptTypeCompletionSource(() => ({
      complete: async () => [
        { label: "map", type: "method" },
        { label: "length", type: "property" },
      ],
    }));
    const result = await source(new CompletionContext(stateFor(doc), pos, true));
    const labels = result?.options.map((option) => option.label) ?? [];

    expect(labels).toContain("map");
    expect(labels).toContain("length");
  });

  test("does not complete inside non-script fences", async () => {
    const doc = '```ts\nconst notes = await kit.notes.searchTags("garden");\nnotes.\n```';
    const pos = doc.lastIndexOf("notes.") + "notes.".length;
    const source = createScriptTypeCompletionSource(() => ({
      complete: async () => [{ label: "shouldNotAppear", type: "property" }],
    }));
    const result = await source(new CompletionContext(stateFor(doc), pos, true));

    expect(result).toBeNull();
  });

  test("language service includes DOM and stdlib-backed kit types", async () => {
    const service = await createScriptIntelligenceService(await loadScriptIntelligenceTypeFiles());

    const documentLabels = service.complete("document.", "document.".length)?.map((option) => option.label) ?? [];
    expect(documentLabels).toContain("querySelector");

    const arrayLabels = service.complete("[1, 2].", "[1, 2].".length)?.map((option) => option.label) ?? [];
    expect(arrayLabels).toContain("map");

    const textLabels = service.complete("kit.text.", "kit.text.".length)?.map((option) => option.label) ?? [];
    expect(textLabels).toContain("slugify");
  });
});
