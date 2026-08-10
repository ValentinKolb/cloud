import { describe, expect, test } from "bun:test";
import { createNoteNavigationCoordinator, type NoteNavigationTarget } from "./note-navigation";

const target = (noteShortId: string): NoteNavigationTarget => ({
  noteShortId,
  canonicalHref: `/app/notebooks/book/notes/${noteShortId}`,
});

const setup = () => {
  let currentNote = "note-a";
  let currentHref = target(currentNote).canonicalHref;
  const sources: string[] = [];
  const order: string[] = [];
  const coordinator = createNoteNavigationCoordinator({
    initialSource: currentHref,
    currentNoteShortId: () => currentNote,
    currentHref: () => currentHref,
    setSource: (source) => sources.push(source),
    pushHistory: (href) => {
      currentHref = href;
      order.push(`history:${href}`);
    },
  });
  const apply = (noteShortId: string) =>
    coordinator.apply(target(noteShortId).canonicalHref, target(noteShortId).canonicalHref, () => {
      currentNote = noteShortId;
      order.push(`apply:${target(noteShortId).canonicalHref}`);
    });
  return { coordinator, sources, order, apply };
};

describe("note navigation coordinator", () => {
  test("supersedes an older request and commits history only after the winning state applies", async () => {
    const state = setup();
    const first = state.coordinator.navigate(target("note-b"), true);
    const second = state.coordinator.navigate(target("note-c"), true);

    expect(await first).toEqual({ kind: "superseded" });
    expect(state.apply("note-b")).toBe(false);
    expect(state.order).toEqual([]);
    expect(state.apply("note-c")).toBe(true);
    expect(await second).toEqual({ kind: "applied", href: target("note-c").canonicalHref });
    expect(state.order).toEqual([`apply:${target("note-c").canonicalHref}`, `history:${target("note-c").canonicalHref}`]);
  });

  test("cancels an in-flight target when navigation returns to the committed note", async () => {
    const state = setup();
    const pending = state.coordinator.navigate(target("note-b"), true);
    const returned = state.coordinator.navigate(target("note-a"), false);

    expect(await pending).toEqual({ kind: "superseded" });
    expect(await returned).toEqual({ kind: "applied", href: target("note-a").canonicalHref });
    expect(state.sources.at(-1)).toBe(target("note-a").canonicalHref);
    expect(state.apply("note-b")).toBe(false);
    expect(state.order).toEqual([]);
  });

  test("rolls a failed request back without writing history", async () => {
    const state = setup();
    const pending = state.coordinator.navigate(target("note-b"), true);

    expect(state.coordinator.fail(target("note-b").canonicalHref)).toBe(true);
    expect(await pending).toEqual({ kind: "fallback" });
    expect(state.sources).toEqual([target("note-b").canonicalHref, target("note-a").canonicalHref]);
    expect(state.order).toEqual([]);
  });

  test("lets only the latest repeated target request observe the commit", async () => {
    const state = setup();
    const first = state.coordinator.navigate(target("note-b"), true);
    const second = state.coordinator.navigate(target("note-b"), true);

    expect(await first).toEqual({ kind: "superseded" });
    expect(state.apply("note-b")).toBe(true);
    expect(await second).toEqual({ kind: "applied", href: target("note-b").canonicalHref });
    expect(state.order).toEqual([`apply:${target("note-b").canonicalHref}`, `history:${target("note-b").canonicalHref}`]);
  });

  test("applies popstate-style navigation without pushing history", async () => {
    const state = setup();
    const pending = state.coordinator.navigate(target("note-b"), false);

    expect(state.apply("note-b")).toBe(true);
    expect(await pending).toEqual({ kind: "applied", href: target("note-b").canonicalHref });
    expect(state.order).toEqual([`apply:${target("note-b").canonicalHref}`]);
  });
});
