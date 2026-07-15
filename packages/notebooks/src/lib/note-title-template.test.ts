import { describe, expect, test } from "bun:test";
import { buildNoteTitleTemplateContext, renderNoteTitleTemplate, validateNoteTitleTemplate } from "./note-title-template";

const context = buildNoteTitleTemplateContext({
  notebook: { id: "notebook-id", short_id: "abc123", name: "Journal" },
  note: { short_id: "def456", depth: 2 },
  parent: { exists: true, id: "parent-id", short_id: "ghi789", title: "Week", path: "2026 / Week" },
  dateConfig: { timeZone: "Europe/Berlin", locale: "en" },
  now: new Date("2026-07-15T12:34:00.000Z"),
});

describe("note title template", () => {
  test("builds deterministic notebook, note, parent, and time context", () => {
    expect(context).toEqual({
      notebook: { id: "notebook-id", short_id: "abc123", name: "Journal" },
      note: { short_id: "def456", depth: 2 },
      parent: { exists: true, id: "parent-id", short_id: "ghi789", title: "Week", path: "2026 / Week" },
      date: "2026-07-15",
      time: "14:34",
      datetime: "2026-07-15T14:34",
      timezone: "Europe/Berlin",
    });
  });

  test("renders conditionals and normalizes the first output line", () => {
    expect(renderNoteTitleTemplate('{% if parent.exists %}{{ parent.title }} - {% endif %}{{ date }}', context)).toBe("Week - 2026-07-15");
    expect(renderNoteTitleTemplate("\n**Daily** note\nignored", context)).toBe("Daily note");
  });

  test("rejects invalid syntax, unknown variables, and empty output", () => {
    expect(validateNoteTitleTemplate("{% include 'x' %}")).toEqual({ ok: false, error: 'Liquid tag "include" is not allowed' });
    expect(() => renderNoteTitleTemplate("{{ missing }}", context)).toThrow();
    expect(() => renderNoteTitleTemplate("   \n", context)).toThrow("rendered an empty title");
    expect(() => renderNoteTitleTemplate("<br>", context)).toThrow("rendered an empty title");
  });
});
