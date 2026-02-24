import { StateField, RangeSet } from "@codemirror/state";
import type { EditorState, Extension, Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import EmojiConvertor from "emoji-js";

const emojiConverter = new EmojiConvertor();
emojiConverter.replace_mode = "unified";
emojiConverter.allow_native = true;

class InlineEmojiWidget extends WidgetType {
  constructor(
    private shortcode: string,
    private emojiChar: string,
  ) {
    super();
  }

  override toDOM() {
    const span = document.createElement("span");
    span.className = "cm-emoji-inline";
    span.setAttribute("data-shortcode", this.shortcode);
    span.textContent = this.emojiChar;
    span.title = this.shortcode;
    return span;
  }

  override eq(other: WidgetType) {
    return other instanceof InlineEmojiWidget && other.shortcode === this.shortcode;
  }

  override ignoreEvent() {
    return false;
  }
}

const findEmojiExpressions = (state: EditorState): Range<Decoration>[] => {
  const decorations: Range<Decoration>[] = [];
  const cursor = state.selection.ranges[0]!;
  const doc = state.doc.toString();

  const codeRanges: { from: number; to: number }[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.type.name === "FencedCode" || node.type.name === "InlineCode" || node.type.name === "CodeBlock") {
        codeRanges.push({ from: node.from, to: node.to });
      }
    },
  });

  const isInsideCode = (from: number, to: number): boolean =>
    codeRanges.some((range) => (from >= range.from && from < range.to) || (to > range.from && to <= range.to));

  const emojiRegex = /:([a-zA-Z0-9_+-]+):/g;
  let match: RegExpExecArray | null = emojiRegex.exec(doc);
  while (match !== null) {
    const from = match.index;
    const to = from + match[0].length;
    const fullShortcode = match[0];

    if (isInsideCode(from, to)) continue;
    if (cursor.from >= from && cursor.to <= to) continue;

    const converted = emojiConverter.replace_colons(fullShortcode);
    if (converted !== fullShortcode) {
      decorations.push(
        Decoration.replace({
          widget: new InlineEmojiWidget(fullShortcode, converted),
        }).range(from, to),
      );
    }
    match = emojiRegex.exec(doc);
  }

  return decorations;
};

export const emojiExtension = (): Extension => {
  const stateField = StateField.define<DecorationSet>({
    create(state) {
      return RangeSet.of(findEmojiExpressions(state), true);
    },
    update(decorations, tr) {
      if (tr.docChanged || tr.selection) {
        return RangeSet.of(findEmojiExpressions(tr.state), true);
      }
      return decorations.map(tr.changes);
    },
    provide(field) {
      return EditorView.decorations.from(field);
    },
  });

  const theme = EditorView.theme({
    ".cm-emoji-inline": {
      fontSize: "inherit",
      verticalAlign: "middle",
      userSelect: "none",
    },
  });

  const eventHandlers = EditorView.domEventHandlers({
    mousedown(event, view) {
      const target = event.target as HTMLElement;
      if (target.classList.contains("cm-emoji-inline")) {
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
