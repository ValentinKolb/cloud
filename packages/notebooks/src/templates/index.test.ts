import { describe, expect, test } from "bun:test";
import { materializeTemplate, templates, type TemplateNoteContentContext } from ".";
import type { Notebook } from "../service/notebooks";
import type { Note } from "../service/notes";

const assertUnique = (values: string[], label: string) => {
  expect(new Set(values).size, `${label} must be unique`).toBe(values.length);
};

const fakeNotebook: Notebook = {
  id: "00000000-0000-0000-0000-000000000001",
  shortId: "abc123",
  name: "Template test",
  description: null,
  icon: null,
  homepageNoteId: null,
  homepageNoteShortId: null,
  scriptsEnabled: false,
  createdBy: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

const fakeNote = (title: string, shortId: string, parentId: string | null): Note => ({
  id: `00000000-0000-0000-0000-${shortId.padStart(12, "0").slice(0, 12)}`,
  shortId,
  notebookId: fakeNotebook.id,
  parentId,
  title,
  position: 0,
  hasChildren: false,
  yjsSnapshotAt: null,
  contentMd: null,
  createdBy: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  lockedAt: null,
});

describe("built-in notebook templates", () => {
  test("template ids are unique", () => {
    assertUnique(templates.map((template) => template.id), "template ids");
  });

  test("materialized notes have unique keys and resolvable content links", () => {
    const now = new Date(2031, 6, 14, 9, 30);

    for (const template of templates) {
      const materialized = materializeTemplate(template, now);
      assertUnique(materialized.notes.map((note) => note.key), `${template.id} note keys`);
      expect(materialized.notes.length, `${template.id} must create real starter notes`).toBeGreaterThanOrEqual(6);

      const keys = new Set(materialized.notes.map((note) => note.key));
      expect(materialized.homepageNoteKey, `${template.id} should declare a homepage note`).toBeTruthy();
      expect(keys.has(materialized.homepageNoteKey!), `${template.id} homepage key must resolve`).toBe(true);
      for (const note of materialized.notes) {
        if (note.parentKey) expect(keys.has(note.parentKey), `${template.id} parent ${note.parentKey}`).toBe(true);
      }

      const notes = new Map<string, Note>();
      for (const [index, note] of materialized.notes.entries()) {
        const parent = note.parentKey ? notes.get(note.parentKey) : null;
        notes.set(note.key, fakeNote(note.title, `n${String(index).padStart(5, "0")}`, parent?.id ?? null));
      }

      const ctx: TemplateNoteContentContext = {
        now,
        notebook: fakeNotebook,
        notes,
        link: (key, label) => {
          const note = notes.get(key);
          if (!note) throw new Error(`missing note ${key}`);
          return `[${label ?? note.title}](note://${note.shortId})`;
        },
        noteId: (key) => {
          const note = notes.get(key);
          if (!note) throw new Error(`missing note ${key}`);
          return note.shortId;
        },
      };

      for (const note of materialized.notes) {
        const content = note.content;
        if (typeof content === "function") expect(() => content(ctx)).not.toThrow();
      }
    }
  });

  test("daily template uses the instantiation year dynamically", () => {
    const materialized = materializeTemplate(templates.find((template) => template.id === "daily-notes")!, new Date(2031, 0, 5));
    expect(materialized.notes.some((note) => note.title === "2031")).toBe(true);
    expect(materialized.notes.some((note) => note.title === "2026")).toBe(false);
  });
});
