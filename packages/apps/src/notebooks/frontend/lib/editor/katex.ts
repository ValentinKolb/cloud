import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension, Range } from "@codemirror/state";
import { RangeSet, StateField } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import katex from "katex";

class InlineMathWidget extends WidgetType {
  constructor(private latex: string) {
    super();
  }

  override toDOM() {
    const span = document.createElement("span");
    span.className = "cm-katex-inline";
    try {
      katex.render(this.latex, span, {
        throwOnError: false,
        displayMode: false,
      });
    } catch {
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

    const mathDiv = document.createElement("div");
    mathDiv.className = "text-center";

    try {
      katex.render(this.latex, mathDiv, {
        throwOnError: false,
        displayMode: true,
      });
    } catch {
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

const findBlockMathExpressions = (state: EditorState): Range<Decoration>[] => {
  const decorations: Range<Decoration>[] = [];
  const cursor = state.selection.ranges[0]!;
  const doc = state.doc.toString();

  const codeRanges: { from: number; to: number }[] = [];

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.type.name === "FencedCode") {
        codeRanges.push({ from: node.from, to: node.to });

        const text = state.sliceDoc(node.from, node.to);
        const lines = text.split("\n");
        const language = lines[0]?.replace("```", "").trim().toLowerCase() || "";

        if (language === "math") {
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

  const isInsideCode = (from: number, to: number): boolean =>
    codeRanges.some(
      (range) => (from >= range.from && from < range.to) || (to > range.from && to <= range.to) || (from <= range.from && to >= range.to),
    );

  const blockMathRegex = /\$\$([^$]+)\$\$|\\\[(.*?)\\\]/gs;
  let match: RegExpExecArray | null = blockMathRegex.exec(doc);
  while (match !== null) {
    const from = match.index;
    const to = from + match[0].length;
    const latex = match[1] ?? match[2] ?? "";
    if (isInsideCode(from, to)) continue;
    if (cursor.from >= from && cursor.to <= to) continue;
    decorations.push(
      Decoration.replace({
        widget: new BlockMathWidget(latex),
        block: true,
      }).range(from, to),
    );
    match = blockMathRegex.exec(doc);
  }

  return decorations;
};

const findInlineMathExpressions = (state: EditorState): Range<Decoration>[] => {
  const decorations: Range<Decoration>[] = [];
  const cursor = state.selection.ranges[0]!;
  const doc = state.doc.toString();

  const codeRanges: { from: number; to: number }[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.type.name === "FencedCode" || node.type.name === "InlineCode") {
        codeRanges.push({ from: node.from, to: node.to });
      }
    },
  });

  const isInsideCode = (from: number, to: number): boolean =>
    codeRanges.some((range) => (from >= range.from && from < range.to) || (to > range.from && to <= range.to));

  const inlineMathRegex = /(?<!\$)\$(?!\$)([^$]+)\$(?!\$)|\\\((.*?)\\\)/g;
  let match: RegExpExecArray | null = inlineMathRegex.exec(doc);
  while (match !== null) {
    const from = match.index;
    const to = from + match[0].length;
    const latex = match[1] ?? match[2] ?? "";
    if (isInsideCode(from, to)) continue;
    if (cursor.from >= from && cursor.to <= to) continue;
    decorations.push(Decoration.replace({ widget: new InlineMathWidget(latex) }).range(from, to));
    match = inlineMathRegex.exec(doc);
  }

  return decorations;
};

export const katexExtension = (): Extension => {
  const stateField = StateField.define<DecorationSet>({
    create(state) {
      return RangeSet.of([...findBlockMathExpressions(state), ...findInlineMathExpressions(state)], true);
    },
    update(decorations, tr) {
      if (tr.docChanged || tr.selection) {
        return RangeSet.of([...findBlockMathExpressions(tr.state), ...findInlineMathExpressions(tr.state)], true);
      }
      return decorations.map(tr.changes);
    },
    provide(field) {
      return EditorView.decorations.from(field);
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
