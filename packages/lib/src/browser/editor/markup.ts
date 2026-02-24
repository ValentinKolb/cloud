/**
 * Markup-hiding extension for CodeMirror.
 *
 * Hides markdown syntax markers when the cursor is not on the same line/range:
 * - Heading markers (# ## ### etc.) — hidden when cursor is on a different line
 * - Bold markers (**) — hidden when cursor is outside the bold range
 * - Italic markers (* or _) — hidden when cursor is outside the italic range
 * - Strikethrough markers (~~) — hidden when cursor is outside the range
 *
 * Also renders horizontal rules (--- / *** / ___) as visual lines.
 */
import { syntaxTree } from "@codemirror/language";
import { RangeSet, StateField } from "@codemirror/state";
import type { EditorState, Extension, Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";

// =============================================================================
// Widgets
// =============================================================================

class HorizontalRuleWidget extends WidgetType {
  override toDOM() {
    const hr = document.createElement("div");
    hr.className = "cm-hr-widget";
    return hr;
  }

  override eq() {
    return true;
  }

  override ignoreEvent() {
    return false;
  }
}

// =============================================================================
// Decoration builders
// =============================================================================

/**
 * Check if the cursor is on a given line.
 */
const cursorOnLine = (state: EditorState, lineFrom: number, lineTo: number): boolean => {
  for (const range of state.selection.ranges) {
    const rLineFrom = state.doc.lineAt(range.from).number;
    const rLineTo = state.doc.lineAt(range.to).number;
    const targetLineFrom = state.doc.lineAt(lineFrom).number;
    const targetLineTo = state.doc.lineAt(lineTo).number;
    if (rLineFrom <= targetLineTo && rLineTo >= targetLineFrom) return true;
  }
  return false;
};

/**
 * Check if the cursor is inside a range (inclusive).
 */
const cursorInRange = (state: EditorState, from: number, to: number): boolean => {
  for (const range of state.selection.ranges) {
    if (range.from <= to && range.to >= from) return true;
  }
  return false;
};

/**
 * Collect all code ranges to avoid decorating inside code blocks.
 */
const getCodeRanges = (state: EditorState): { from: number; to: number }[] => {
  const ranges: { from: number; to: number }[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.type.name === "FencedCode" || node.type.name === "InlineCode" || node.type.name === "CodeBlock") {
        ranges.push({ from: node.from, to: node.to });
      }
    },
  });
  return ranges;
};

const isInsideCode = (codeRanges: { from: number; to: number }[], from: number, to: number): boolean =>
  codeRanges.some((r) => from >= r.from && to <= r.to);

/**
 * Build all decorations for markup hiding and horizontal rules.
 */
const buildDecorations = (state: EditorState): Range<Decoration>[] => {
  const decorations: Range<Decoration>[] = [];
  const codeRanges = getCodeRanges(state);

  syntaxTree(state).iterate({
    enter: (node) => {
      const { name, from, to } = node;

      // ---------------------------------------------------------------
      // Headings: hide the "# " marker when cursor is on another line
      // ---------------------------------------------------------------
      if (name.startsWith("ATXHeading")) {
        if (isInsideCode(codeRanges, from, to)) return;
        if (cursorOnLine(state, from, to)) return;

        // Find the HeaderMark node (the # characters)
        let markEnd = from;
        const nodeRef = node.node;
        const markCursor = nodeRef.cursor();
        if (markCursor.firstChild()) {
          do {
            if (markCursor.name === "HeaderMark") {
              // Include the space after the #
              markEnd = markCursor.to;
              const afterMark = state.doc.sliceString(markEnd, markEnd + 1);
              if (afterMark === " ") markEnd++;
              break;
            }
          } while (markCursor.nextSibling());
        }

        if (markEnd > from) {
          decorations.push(Decoration.replace({}).range(from, markEnd));
        }
        return;
      }

      // ---------------------------------------------------------------
      // Bold: hide ** or __ markers
      // ---------------------------------------------------------------
      if (name === "StrongEmphasis") {
        if (isInsideCode(codeRanges, from, to)) return;
        if (cursorInRange(state, from, to)) return;

        const text = state.doc.sliceString(from, to);
        const marker = text.startsWith("**") ? "**" : text.startsWith("__") ? "__" : null;
        if (!marker) return;

        const markerLen = marker.length;
        // Hide opening marker
        decorations.push(Decoration.replace({}).range(from, from + markerLen));
        // Hide closing marker
        decorations.push(Decoration.replace({}).range(to - markerLen, to));
        return;
      }

      // ---------------------------------------------------------------
      // Italic: hide * or _ markers
      // ---------------------------------------------------------------
      if (name === "Emphasis") {
        if (isInsideCode(codeRanges, from, to)) return;
        if (cursorInRange(state, from, to)) return;

        const text = state.doc.sliceString(from, to);
        const marker = text.startsWith("*") ? "*" : text.startsWith("_") ? "_" : null;
        if (!marker) return;

        const markerLen = marker.length;
        // Hide opening marker
        decorations.push(Decoration.replace({}).range(from, from + markerLen));
        // Hide closing marker
        decorations.push(Decoration.replace({}).range(to - markerLen, to));
        return;
      }

      // ---------------------------------------------------------------
      // Strikethrough: hide ~~ markers
      // ---------------------------------------------------------------
      if (name === "Strikethrough") {
        if (isInsideCode(codeRanges, from, to)) return;
        if (cursorInRange(state, from, to)) return;

        // Hide opening ~~
        decorations.push(Decoration.replace({}).range(from, from + 2));
        // Hide closing ~~
        decorations.push(Decoration.replace({}).range(to - 2, to));
        return;
      }

      // ---------------------------------------------------------------
      // Horizontal Rule: replace --- / *** / ___ with a visual line
      // ---------------------------------------------------------------
      if (name === "HorizontalRule") {
        if (cursorOnLine(state, from, to)) return;

        decorations.push(
          Decoration.replace({
            widget: new HorizontalRuleWidget(),
            block: true,
          }).range(from, to),
        );
        return;
      }
    },
  });

  return decorations;
};

// =============================================================================
// Extension
// =============================================================================

export const markupExtension = (): Extension => {
  const stateField = StateField.define<DecorationSet>({
    create(state) {
      return RangeSet.of(buildDecorations(state), true);
    },
    update(decorations, tr) {
      if (tr.docChanged || tr.selection) {
        return RangeSet.of(buildDecorations(tr.state), true);
      }
      return decorations.map(tr.changes);
    },
    provide(field) {
      return EditorView.decorations.from(field);
    },
  });

  const theme = EditorView.theme({
    ".cm-hr-widget": {
      borderTop: "2px solid",
      borderColor: "var(--color-zinc-300)",
      margin: "0.75em 0",
    },
    ".dark .cm-hr-widget": {
      borderColor: "var(--color-zinc-600)",
    },
  });

  const eventHandlers = EditorView.domEventHandlers({
    mousedown(event, view) {
      const target = event.target as HTMLElement;
      if (target.classList.contains("cm-hr-widget")) {
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
