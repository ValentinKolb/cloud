import { RangeSet } from "@codemirror/state";
import type { EditorState, Extension, Range, Transaction } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { type CursorZoneState, cursorZoneStateField } from "./_lib/cursor-zone-field";

type BlockType = "note" | "info" | "success" | "warning" | "danger";

type InfoBlockData = {
  type: BlockType;
  content: string;
};

const blockConfig = {
  note: {
    icon: "ti-chevron-right",
    label: "Note",
    blockClass: "info-block-note",
  },
  info: {
    icon: "ti-info-circle",
    label: "Info",
    blockClass: "info-block-info",
  },
  success: {
    icon: "ti-check",
    label: "Success",
    blockClass: "info-block-success",
  },
  warning: {
    icon: "ti-alert-circle",
    label: "Warning",
    blockClass: "info-block-warning",
  },
  danger: {
    icon: "ti-alert-hexagon",
    label: "Danger",
    blockClass: "info-block-danger",
  },
} as const;

const parseInfoBlock = (text: string): InfoBlockData | null => {
  const match = text.match(/^:::(\w+)\s*\n([\s\S]*?)\n:::$/);
  if (!match) return null;

  const typeStr = match[1];
  const content = match[2];
  if (!typeStr || content == null) return null;
  const type = typeStr.toLowerCase() as BlockType;
  if (!blockConfig[type]) return null;

  return { type, content: content.trim() };
};

const renderContent = (content: string): string => {
  return content
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code class='bg-black/10 dark:bg-white/10 px-1 py-0.5 rounded text-sm'>$1</code>")
    .replace(/\n/g, "<br>")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/&lt;(\/?(strong|em|code|br)[^&]*)&gt;/g, "<$1>");
};

class InfoBlockWidget extends WidgetType {
  private container: HTMLElement | null = null;

  constructor(
    private blockData: InfoBlockData,
    private fromPos: number,
  ) {
    super();
  }

  override toDOM(view: EditorView) {
    if (!this.container) {
      this.container = document.createElement("div");
      this.container.className = "cm-info-block-widget my-2 cursor-pointer";
      this.container.setAttribute("contenteditable", "false");
      this.container.setAttribute("tabindex", "0");
      this.container.onmousedown = (event) => {
        event.preventDefault();
        event.stopPropagation();
        view.dispatch({ selection: { anchor: this.fromPos }, scrollIntoView: true });
        view.focus();
      };
      this.container.ondblclick = (event) => {
        event.stopPropagation();
      };

      const config = blockConfig[this.blockData.type];

      const block = document.createElement("div");
      block.className = config.blockClass;

      // Header line: icon + label
      const header = document.createElement("div");
      header.className = "flex items-center gap-1.5 font-semibold mb-1";

      const icon = document.createElement("i");
      icon.className = `ti ${config.icon} shrink-0`;

      const label = document.createElement("span");
      label.textContent = config.label;

      header.appendChild(icon);
      header.appendChild(label);

      // Content
      const contentDiv = document.createElement("div");
      contentDiv.innerHTML = renderContent(this.blockData.content);

      block.appendChild(header);
      block.appendChild(contentDiv);
      this.container.appendChild(block);
    }

    return this.container;
  }

  override eq(other: WidgetType) {
    return (
      other instanceof InfoBlockWidget &&
      other.fromPos === this.fromPos &&
      other.blockData.type === this.blockData.type &&
      other.blockData.content === this.blockData.content
    );
  }

  override ignoreEvent() {
    return true;
  }

  override get estimatedHeight() {
    const lines = this.blockData.content.split("\n").length;
    return Math.max(60, lines * 20 + 40);
  }
}

const BLOCK_REGEX = /^:::(\w+)\s*\n([\s\S]*?)\n:::$/gm;

/** Source-byte ranges of every `:::TYPE…:::` block drive the
 *  cursor-zone rebuild gate — cursor moves through plain prose
 *  skip the full doc.toString() + matchAll() rescan because the
 *  key (= which block contains the cursor) doesn't change. Doc
 *  changes are gated by `changesMightAffectBlocks` below — typing
 *  in prose without any `:` skips the rescan entirely. */
const findInfoBlocks = (state: EditorState): CursorZoneState => {
  const decorations: Range<Decoration>[] = [];
  const atomicDecorations: Range<Decoration>[] = [];
  const ranges: { from: number; to: number }[] = [];
  const cursor = state.selection.ranges[0]!;
  const text = state.doc.toString();
  let hasSyntax = false;

  // `matchAll` yields an iterator that auto-advances per loop step, so a
  // `continue` (used to skip rendering when the cursor sits inside a block)
  // doesn't pin the regex on the same match — which is what an inline
  // `regex.exec` loop would do, and exactly what produced the editor
  // freeze when typing `/info` `/success` etc. via slash commands.
  for (const match of text.matchAll(BLOCK_REGEX)) {
    if (match.index === undefined) continue;
    const blockStart = match.index;
    const blockEnd = blockStart + match[0].length;
    const prevLine = state.doc.lineAt(Math.max(blockStart - 1, 0));
    const nextLine = state.doc.lineAt(Math.min(blockEnd + 1, state.doc.length));
    const sourceVisibleEnd = nextLine.to;
    const sourceVisibleStart = prevLine.from;
    hasSyntax = true;
    ranges.push({ from: sourceVisibleStart, to: sourceVisibleEnd });

    // Cursor is inside the block → don't render the widget so the user
    // can edit the raw `:::xxx` markers.
    if (cursor.from >= sourceVisibleStart && cursor.to <= sourceVisibleEnd) continue;

    const blockData = parseInfoBlock(match[0]);
    if (!blockData) continue;
    const blockDecoration = Decoration.replace({
      widget: new InfoBlockWidget(blockData, blockStart),
      block: true,
    }).range(blockStart, blockEnd);
    decorations.push(blockDecoration);
    atomicDecorations.push(blockDecoration);
  }

  return {
    decorations: decorations.length > 0 ? RangeSet.of(decorations, true) : Decoration.none,
    atomicDecorations: atomicDecorations.length > 0 ? RangeSet.of(atomicDecorations, true) : Decoration.none,
    ranges,
    hasSyntax,
  };
};

/** Predicate for the incremental cursor-zone mode. The block
 *  fence is `:::` so any change involving `:` is suspect. False
 *  positives (typing `:` in a URL, time, dict literal) fall back
 *  to baseline (full rescan); false negatives would leave stale
 *  widgets, so the predicate is intentionally generous. */
const changesMightAffectBlocks = (tr: Transaction): boolean => {
  let might = false;
  tr.changes.iterChanges((_fromA, _toA, fromB, toB, inserted) => {
    if (might) return;
    if (inserted.toString().includes(":")) {
      might = true;
      return;
    }
    const from = Math.max(0, fromB - 2);
    const to = Math.min(tr.state.doc.length, toB + 2);
    might = tr.state.doc.sliceString(from, to).includes(":");
  });
  return might;
};

export const infoBlocksExtension = (): Extension => {
  const stateField = cursorZoneStateField(findInfoBlocks, {
    changesMightAffectSyntax: changesMightAffectBlocks,
  });

  const theme = EditorView.theme({
    ".cm-info-block-widget": {
      display: "block",
      margin: "0 !important",
      lineHeight: "1",
    },
  });

  return [stateField, theme];
};
