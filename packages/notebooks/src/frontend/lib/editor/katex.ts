import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension, Range, Transaction } from "@codemirror/state";
import { RangeSet, StateField } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import katex from "katex";

// =============================================================================
// Module-scoped render cache
// =============================================================================
//
// KaTeX is fast (~1–5ms per formula), but on a Numpy-style note with 50+
// formulas, repeatedly re-rendering on scroll-past-and-back adds up. CM's
// widget reuse handles the in-viewport case via `eq()`, but widgets that
// scroll out of the viewport are destroyed + recreated → fresh katex.render
// every time. Cache the rendered DOM keyed by (mode, latex) and hand out
// deep clones so callers can insert without aliasing.
//
// `cloneNode(true)` is safe here: katex output is plain spans + divs with
// CSS classes (no event handlers, no shadow DOM, no canvas). The font
// references live in global stylesheets so classes survive the clone.

type RenderEntry = { node: HTMLElement; timestamp: number };
const RENDER_CACHE_MAX = 200;
const renderCache = new Map<string, RenderEntry>();

/** Single-pass min-by-timestamp eviction (mirrors mermaid's
 *  `evictOldestSvg`). LRU keeps the working set hot without
 *  scanning + sorting on every overflow. */
const evictOldestRender = (): void => {
  let oldestKey: string | undefined;
  let oldestTs = Number.POSITIVE_INFINITY;
  for (const [k, e] of renderCache) {
    if (e.timestamp < oldestTs) {
      oldestTs = e.timestamp;
      oldestKey = k;
    }
  }
  if (oldestKey !== undefined) renderCache.delete(oldestKey);
};

/** Render LaTeX to a detached DOM element (block or inline). On
 *  cache hit, returns a deep clone of the cached prototype and
 *  bumps its timestamp for LRU. On miss, runs `katex.render` once,
 *  caches the prototype, returns a clone. Returns `null` if katex
 *  throws (rare with `throwOnError: false`, but defensive) so the
 *  caller can render the error fallback instead. */
const tryRenderKatex = (latex: string, displayMode: boolean): HTMLElement | null => {
  const key = `${displayMode ? "B" : "I"}:${latex}`;
  const entry = renderCache.get(key);
  if (entry) {
    entry.timestamp = Date.now();
    return entry.node.cloneNode(true) as HTMLElement;
  }
  // Use a `div` host for block math (katex-display wraps as block)
  // and a `span` for inline so the natural flow keeps inline math
  // inline.
  const prototype = document.createElement(displayMode ? "div" : "span");
  try {
    katex.render(latex, prototype, { throwOnError: false, displayMode });
  } catch {
    return null;
  }
  renderCache.set(key, { node: prototype, timestamp: Date.now() });
  if (renderCache.size > RENDER_CACHE_MAX) evictOldestRender();
  return prototype.cloneNode(true) as HTMLElement;
};

class InlineMathWidget extends WidgetType {
  constructor(private latex: string) {
    super();
  }

  override toDOM() {
    const rendered = tryRenderKatex(this.latex, false);
    const span = rendered ?? document.createElement("span");
    span.className = "cm-katex-inline";
    if (!rendered) {
      span.innerHTML = `<span class="cm-katex-error text-red-500">$${this.latex}$</span>`;
    }
    return span;
  }

  override ignoreEvent(event: Event) {
    return event.type !== "mousedown";
  }

  override eq(other: WidgetType) {
    return other instanceof InlineMathWidget && other.latex === this.latex;
  }
}

class BlockMathWidget extends WidgetType {
  constructor(private latex: string) {
    super();
  }

  override toDOM() {
    const container = document.createElement("div");
    container.className = "cm-katex-block !m-0";
    container.setAttribute("contenteditable", "false");

    const wrapper = document.createElement("div");
    wrapper.className = "p-1 overflow-x-auto flex items-center justify-center";

    const rendered = tryRenderKatex(this.latex, true);
    const mathDiv = rendered ?? document.createElement("div");
    mathDiv.className = "text-center";
    if (!rendered) {
      mathDiv.innerHTML = `
        <div class="text-red-500 font-mono text-sm">
          <i class="ti ti-alert-circle"></i> Invalid LaTeX
          <pre class="mt-2">${this.latex}</pre>
        </div>`;
    }

    wrapper.appendChild(mathDiv);
    container.appendChild(wrapper);
    return container;
  }

  override eq(other: WidgetType) {
    return other instanceof BlockMathWidget && other.latex === this.latex;
  }

  override ignoreEvent(event: Event) {
    return event.type !== "mousedown";
  }
}

type KatexDecorationState = {
  decorations: DecorationSet;
  hasMathSyntax: boolean;
  mathRanges: { from: number; to: number }[];
};

const hasMathMarker = (text: string): boolean => text.includes("$") || text.includes("\\");

const changesMightAffectMath = (tr: Transaction): boolean => {
  let might = false;
  tr.changes.iterChanges((_fromA, _toA, fromB, toB, inserted) => {
    if (might) return;
    if (hasMathMarker(inserted.toString())) {
      might = true;
      return;
    }

    const from = Math.max(0, fromB - 2);
    const to = Math.min(tr.state.doc.length, toB + 2);
    might = hasMathMarker(tr.state.doc.sliceString(from, to));
  });
  return might;
};

const intersectsAnyRange = (ranges: { from: number; to: number }[], from: number, to: number): boolean =>
  ranges.some(
    (range) => (from >= range.from && from < range.to) || (to > range.from && to <= range.to) || (from <= range.from && to >= range.to),
  );

const changesIntersectRanges = (tr: Transaction, ranges: { from: number; to: number }[]): boolean => {
  if (ranges.length === 0) return false;
  let intersects = false;
  tr.changes.iterChangedRanges((fromA, toA) => {
    if (intersects) return;
    intersects = intersectsAnyRange(ranges, fromA, toA) || ranges.some((range) => fromA === range.from || fromA === range.to);
  });
  return intersects;
};

const mapRanges = (tr: Transaction, ranges: { from: number; to: number }[]): { from: number; to: number }[] =>
  ranges.map((range) => ({
    from: tr.changes.mapPos(range.from, 1),
    to: tr.changes.mapPos(range.to, -1),
  }));

/** Identity of the math range the cursor currently sits inside, or
 *  null if it sits in prose. A cursor-only transaction needs a
 *  rebuild only when this answer changes between transactions —
 *  same pattern the `_lib/cursor-zone-field` helper applies to
 *  images/links/tag-pill/info-blocks. Inlined here rather than
 *  reusing that helper because katex's state field carries extra
 *  fields (hasMathSyntax + the math-marker change detector) that
 *  don't fit the generic two-field shape. */
const cursorMathKey = (
  cursor: { from: number; to: number },
  ranges: { from: number; to: number }[],
): number | null => {
  if (ranges.length === 0) return null;
  for (const r of ranges) {
    if (cursor.from >= r.from && cursor.to <= r.to) return r.from;
  }
  return null;
};

const buildKatexDecorations = (state: EditorState): KatexDecorationState => {
  const decorations: Range<Decoration>[] = [];
  const cursor = state.selection.ranges[0]!;
  const doc = state.doc.toString();
  let hasMathSyntax = false;
  const mathRanges: { from: number; to: number }[] = [];

  const codeRanges: { from: number; to: number }[] = [];

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.type.name === "FencedCode") {
        codeRanges.push({ from: node.from, to: node.to });

        const text = state.sliceDoc(node.from, node.to);
        const lines = text.split("\n");
        const language = lines[0]?.replace("```", "").trim().toLowerCase() || "";

        if (language === "math") {
          hasMathSyntax = true;
          mathRanges.push({ from: node.from, to: node.to });
          if (cursor.from >= node.from && cursor.to <= node.to) return false;
          const latex = lines.slice(1, -1).join("\n");
          decorations.push(
            Decoration.replace({
              widget: new BlockMathWidget(latex),
              block: true,
            }).range(node.from, node.to),
          );
        }
      }
      if (node.type.name === "InlineCode") {
        codeRanges.push({ from: node.from, to: node.to });
      }
    },
  });

  /**
   * Walk a global regex over the doc, push a decoration per match
   * UNLESS the match falls inside a code range (handled separately)
   * or the cursor sits inside it (= edit mode for that math snippet).
   *
   * CRITICAL: advance `match = re.exec(doc)` BEFORE any `continue`.
   * The regex's `lastIndex` only moves when `.exec` runs; a `continue`
   * after a skip-decision without re-exec would pin the regex on the
   * same match → infinite loop → tab freeze. Observed when the doc
   * contained a `$$…$$` or `\[…\]` inside a code block.
   */
  const scanMath = (re: RegExp, makeWidget: (latex: string) => WidgetType, blockWidget: boolean) => {
    let match: RegExpExecArray | null = re.exec(doc);
    while (match !== null) {
      const from = match.index;
      const to = from + match[0].length;
      const latex = match[1] ?? match[2] ?? "";
      hasMathSyntax = true;
      mathRanges.push({ from, to });
      const cursorInside = cursor.from >= from && cursor.to <= to;
      const skip = intersectsAnyRange(codeRanges, from, to) || cursorInside;
      match = re.exec(doc);
      if (skip) continue;
      decorations.push(
        Decoration.replace(blockWidget ? { widget: makeWidget(latex), block: true } : { widget: makeWidget(latex) })
          .range(from, to),
      );
    }
  };

  scanMath(/\$\$([^$]+)\$\$|\\\[(.*?)\\\]/gs, (latex) => new BlockMathWidget(latex), true);
  scanMath(/(?<!\$)\$(?!\$)([^$]+)\$(?!\$)|\\\((.*?)\\\)/g, (latex) => new InlineMathWidget(latex), false);

  return {
    decorations: decorations.length > 0 ? RangeSet.of(decorations, true) : Decoration.none,
    hasMathSyntax,
    mathRanges,
  };
};

export const katexExtension = (): Extension => {
  const stateField = StateField.define<KatexDecorationState>({
    create(state) {
      return buildKatexDecorations(state);
    },
    update(value, tr) {
      if (tr.docChanged) {
        const decorations = value.decorations.map(tr.changes);
        const mathRanges = mapRanges(tr, value.mathRanges);
        const mightAffectMath = changesMightAffectMath(tr);
        if (!value.hasMathSyntax && !mightAffectMath) {
          return { decorations, hasMathSyntax: false, mathRanges: [] };
        }
        if (value.hasMathSyntax && !changesIntersectRanges(tr, value.mathRanges) && !mightAffectMath) {
          return { decorations, hasMathSyntax: true, mathRanges };
        }
        return buildKatexDecorations(tr.state);
      }
      if (tr.selection && value.hasMathSyntax) {
        // Cursor moved — only rebuild when the cursor crossed a
        // math boundary (entered, left, or moved between math
        // spans). For most cursor moves through prose this is a
        // no-op and we skip the full doc.toString + matchAll
        // rescan. Note: `value.mathRanges` are pre-transaction
        // positions but `!tr.docChanged` here, so positions are
        // stable and we can compare directly against tr.state's
        // cursor.
        const oldKey = cursorMathKey(tr.startState.selection.main, value.mathRanges);
        const newKey = cursorMathKey(tr.state.selection.main, value.mathRanges);
        if (oldKey === newKey) return value;
        return buildKatexDecorations(tr.state);
      }
      return { ...value, decorations: value.decorations.map(tr.changes) };
    },
    provide(field) {
      return EditorView.decorations.from(field, (value) => value.decorations);
    },
  });

  const theme = EditorView.theme({
    ".cm-katex-inline": {
      display: "inline-block",
      padding: "0 4px",
      borderRadius: "var(--radius-sm)",
      lineHeight: "1",
    },
    ".cm-katex-inline:hover": { background: "rgba(59, 130, 246, 0.05)" },
    ".cm-katex-block": {
      display: "block",
      margin: "0 !important",
      borderRadius: "var(--radius-sm)",
    },
    ".cm-katex-block:hover": { background: "rgba(59, 130, 246, 0.05)" },
    ".cm-katex-error": {
      fontFamily: "var(--font-mono)",
      fontSize: "0.875em",
      padding: "0 2px",
    },
  });

  const eventHandlers = EditorView.domEventHandlers({
    mousedown(event, view) {
      const target = event.target as HTMLElement;
      if (target.closest(".cm-katex-block")) {
        const pos = view.posAtDOM(target);
        if (pos !== null) {
          view.dispatch({ selection: { anchor: pos } });
          return true;
        }
      }
      return false;
    },
  });

  return [stateField, theme, eventHandlers];
};
