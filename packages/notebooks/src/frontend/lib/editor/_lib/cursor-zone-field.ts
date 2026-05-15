/**
 * Cursor-zone StateField — shared by editor decoration pipelines
 * that rebuild on doc changes OR when the cursor crosses a "zone"
 * boundary (entered, left, or moved between zones).
 *
 * # Two modes
 *
 * The field supports two operating modes:
 *
 *  - **Default mode** (no `incremental` option): rebuild on every
 *    doc change, rebuild on selection changes that cross a range
 *    boundary. Used by image/link extensions whose `build` already
 *    walks the syntax tree incrementally — a full call is cheap.
 *
 *  - **Incremental mode** (with `incremental.changesMightAffectSyntax`):
 *    on doc change, skip the rebuild when the doc has no relevant
 *    marker syntax AND the change doesn't introduce any, OR when
 *    the existing ranges are unaffected by the change. Used by
 *    extensions whose `build` does a full `doc.toString() +
 *    regex.matchAll()` pass (katex, tag-pill, info-blocks) — those
 *    rebuilds are expensive enough to be worth gating.
 *
 * Each caller (images, links, tag-pill, info-blocks, katex) tracks
 * the source-byte ranges where editing should reveal raw markdown
 * source instead of the rendered widget. Without the cursor-zone
 * gate, every plain cursor move through prose would re-walk the
 * syntax tree / re-scan the doc text — visibly laggy on long notes.
 *
 * # State shape
 *
 * Callers return `{ decorations, ranges, hasSyntax? }` from `build`.
 * `hasSyntax` only matters in incremental mode; default mode
 * ignores it.
 *
 * NOTE: `tables.ts` does NOT use this helper — its state carries
 * an extra cached `blockWidgetDecorations` field that doesn't fit
 * the standard shape.
 */
import { forceParsing } from "@codemirror/language";
import { StateEffect, StateField } from "@codemirror/state";
import type { EditorState, Extension, Transaction } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";

export type CursorZoneRange = { from: number; to: number };

export type CursorZoneState = {
  decorations: DecorationSet;
  /** Optional subset of replacement decorations that should behave
   *  atomically for cursor movement. Use this for block widgets that
   *  hide source text; it prevents CM from resolving mouse/vertical
   *  navigation into the replaced source range. */
  atomicDecorations?: DecorationSet;
  /** Source-byte ranges where the cursor "activates" the source
   *  (i.e. hides the widget so the user can edit raw markdown). */
  ranges: CursorZoneRange[];
  /** Incremental mode only: `true` if the doc currently contains
   *  any relevant marker syntax. Lets the field skip the rebuild
   *  when both this AND the per-change predicate return falsy. */
  hasSyntax?: boolean;
};

export type IncrementalOptions = {
  /** Cheap predicate run on every doc-change transaction. Returns
   *  `true` if the inserted text OR a small window around the
   *  change might introduce / remove relevant marker syntax.
   *
   *  Bias: when in doubt, return `true` — a false positive only
   *  costs a rebuild (back to baseline). A false negative leaves
   *  decorations stale, so the predicate MUST be conservative. */
  changesMightAffectSyntax: (tr: Transaction) => boolean;
};

export const refreshMarkdownDecorationsEffect = StateEffect.define<void>();

export const initialMarkdownDecorationRefreshExtension = (): Extension =>
  ViewPlugin.fromClass(
    class {
      private raf: number | null = null;
      private attempts = 0;

      constructor(private view: EditorView) {
        this.schedule();
      }

      private schedule() {
        this.raf = window.requestAnimationFrame(() => {
          this.raf = null;
          this.attempts += 1;
          // Markdown parsing is viewport/background-driven. Force one parse
          // pass after mount so syntax-tree based widgets don't stay raw until
          // the first cursor transaction.
          const parsed = forceParsing(this.view, this.view.state.doc.length, 50);
          this.view.dispatch({ effects: refreshMarkdownDecorationsEffect.of() });
          if (!parsed && this.attempts < 4) this.schedule();
        });
      }

      destroy() {
        if (this.raf !== null) window.cancelAnimationFrame(this.raf);
      }
    },
  );

/** Identity of the range the cursor currently sits inside, or
 *  `null` if it sits outside all ranges. A cursor-only transaction
 *  needs a rebuild only when this answer changes. */
const cursorKey = (state: EditorState, ranges: CursorZoneRange[]): number | null => {
  if (ranges.length === 0) return null;
  const cursor = state.selection.main;
  for (const r of ranges) {
    if (cursor.from >= r.from && cursor.to <= r.to) return r.from;
  }
  return null;
};

const intersectsAnyRange = (ranges: CursorZoneRange[], from: number, to: number): boolean =>
  ranges.some(
    (r) =>
      (from >= r.from && from < r.to) ||
      (to > r.from && to <= r.to) ||
      (from <= r.from && to >= r.to),
  );

/** True if any of the transaction's changed regions intersects (or
 *  touches the boundary of) one of `ranges`. Pre-change positions
 *  are used because `ranges` haven't been mapped through `tr` yet. */
const changesIntersectRanges = (tr: Transaction, ranges: CursorZoneRange[]): boolean => {
  if (ranges.length === 0) return false;
  let intersects = false;
  tr.changes.iterChangedRanges((fromA, toA) => {
    if (intersects) return;
    intersects =
      intersectsAnyRange(ranges, fromA, toA) ||
      ranges.some((r) => fromA === r.from || fromA === r.to);
  });
  return intersects;
};

/** Map pre-change ranges through a transaction's changes so they
 *  reflect the post-change document. `from` biases right, `to`
 *  biases left — keeps the range tight around the original span. */
const mapRanges = (tr: Transaction, ranges: CursorZoneRange[]): CursorZoneRange[] =>
  ranges.map((r) => ({
    from: tr.changes.mapPos(r.from, 1),
    to: tr.changes.mapPos(r.to, -1),
  }));

export const cursorZoneStateField = (
  build: (state: EditorState) => CursorZoneState,
  incremental?: IncrementalOptions,
): Extension => {
  return StateField.define<CursorZoneState>({
    create: build,
    update(value, tr) {
      if (tr.effects.some((effect) => effect.is(refreshMarkdownDecorationsEffect))) {
        return build(tr.state);
      }
      if (tr.docChanged) {
        if (incremental) {
          const decorations = value.decorations.map(tr.changes);
          const atomicDecorations = value.atomicDecorations?.map(tr.changes);
          const mightAffect = incremental.changesMightAffectSyntax(tr);
          // No syntax anywhere AND change doesn't introduce any →
          // nothing to scan, just keep an empty state.
          if (!value.hasSyntax && !mightAffect) {
            return { decorations, atomicDecorations, ranges: [], hasSyntax: false };
          }
          // Have syntax, change misses the ranges AND introduces
          // no new markers → keep current decorations, just remap
          // range positions through the change.
          if (
            value.hasSyntax &&
            !changesIntersectRanges(tr, value.ranges) &&
            !mightAffect
          ) {
            return {
              decorations,
              atomicDecorations,
              ranges: mapRanges(tr, value.ranges),
              hasSyntax: true,
            };
          }
        }
        return build(tr.state);
      }
      if (!tr.selection) return value;
      const oldKey = cursorKey(tr.startState, value.ranges);
      const newKey = cursorKey(tr.state, value.ranges);
      if (oldKey === newKey) return value;
      return build(tr.state);
    },
    provide(field) {
      return [
        EditorView.decorations.from(field, (v) => v.decorations),
        EditorView.atomicRanges.of((view) => view.state.field(field).atomicDecorations ?? Decoration.none),
      ];
    },
  });
};
