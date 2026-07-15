import { describe, expect, test } from "bun:test";
import { createInitialNoteMarkdown, deriveNoteTitle, hasUsableNoteTitle, NOTE_TITLE_MAX_LENGTH, normalizeNoteTitle } from "./note-title";

describe("note title", () => {
  test("prefers the first ATX H1 over earlier content", () => {
    expect(deriveNoteTitle("Intro text\n\n## Section\n\n# Canonical title\n")).toBe("Canonical title");
  });

  test("supports Setext H1 headings", () => {
    expect(deriveNoteTitle("Canonical *title*\n=================\nBody")).toBe("Canonical title");
  });

  test("ignores headings inside fenced code", () => {
    expect(deriveNoteTitle("```md\n# Not the title\n```\n\n# Real title")).toBe("Real title");
    expect(deriveNoteTitle("~~~\n# Hidden\n~~~\nFirst visible line")).toBe("First visible line");
  });

  test("uses the first non-empty content line when no H1 exists", () => {
    expect(deriveNoteTitle("\n> A **linked** [idea](https://example.com)\n\nBody")).toBe("A linked idea");
  });

  test("skips empty headings and non-visible lines", () => {
    expect(deriveNoteTitle("# <br>\n\n<!-- hidden -->\n\nVisible title")).toBe("Visible title");
  });

  test("normalizes inline Markdown and entities", () => {
    expect(deriveNoteTitle("# `API` &amp; ![Cloud](cloud.png) ~~draft~~")).toBe("API & Cloud draft");
  });

  test("returns Untitled for empty or unusable documents", () => {
    expect(deriveNoteTitle("\n```\n# hidden\n```\n---\n")).toBe("Untitled");
    expect(hasUsableNoteTitle("\n```\n# hidden\n```\n---\n")).toBe(false);
    expect(hasUsableNoteTitle("# Untitled")).toBe(true);
  });

  test("caps titles by Unicode code point", () => {
    const longTitle = "🙂".repeat(NOTE_TITLE_MAX_LENGTH + 10);
    expect(Array.from(normalizeNoteTitle(longTitle))).toHaveLength(NOTE_TITLE_MAX_LENGTH);
  });

  test("builds canonical initial Markdown", () => {
    expect(createInitialNoteMarkdown("New **Document**")).toBe("# New Document\n");
  });

  test("preserves supplied content when prepending an initial title", () => {
    expect(createInitialNoteMarkdown("New Document", "```text\nbody\n```\n")).toBe("# New Document\n\n```text\nbody\n```\n");
  });
});
