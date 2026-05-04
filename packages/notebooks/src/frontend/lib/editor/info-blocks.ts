import { StateField, RangeSet } from "@codemirror/state";
import type { EditorState, Extension, Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";

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

  constructor(private blockData: InfoBlockData) {
    super();
  }

  override toDOM() {
    if (!this.container) {
      this.container = document.createElement("div");
      this.container.className = "cm-info-block-widget my-2 cursor-pointer";
      this.container.setAttribute("contenteditable", "false");
      this.container.setAttribute("tabindex", "0");

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
      other instanceof InfoBlockWidget && other.blockData.type === this.blockData.type && other.blockData.content === this.blockData.content
    );
  }

  override ignoreEvent(event: Event) {
    return event.type !== "mousedown";
  }

  override get estimatedHeight() {
    const lines = this.blockData.content.split("\n").length;
    return Math.max(60, lines * 20 + 40);
  }
}

const BLOCK_REGEX = /^:::(\w+)\s*\n([\s\S]*?)\n:::$/gm;

const findInfoBlocks = (state: EditorState): Range<Decoration>[] => {
  const decorations: Range<Decoration>[] = [];
  const cursor = state.selection.ranges[0]!;
  const text = state.doc.toString();

  // `matchAll` yields an iterator that auto-advances per loop step, so a
  // `continue` (used to skip rendering when the cursor sits inside a block)
  // doesn't pin the regex on the same match — which is what an inline
  // `regex.exec` loop would do, and exactly what produced the editor
  // freeze when typing `/info` `/success` etc. via slash commands.
  for (const match of text.matchAll(BLOCK_REGEX)) {
    if (match.index === undefined) continue;
    const blockStart = match.index;
    const blockEnd = blockStart + match[0].length;
    const nextLine = state.doc.lineAt(Math.min(blockEnd + 1, state.doc.length));

    // Cursor is inside the block → don't render the widget so the user
    // can edit the raw `:::xxx` markers.
    if (cursor.from >= blockStart && cursor.to <= nextLine.to) continue;

    const blockData = parseInfoBlock(match[0]);
    if (!blockData) continue;
    decorations.push(
      Decoration.replace({
        widget: new InfoBlockWidget(blockData),
        block: true,
      }).range(blockStart, blockEnd),
    );
  }

  return decorations;
};

export const infoBlocksExtension = (): Extension => {
  const stateField = StateField.define<DecorationSet>({
    create(state) {
      return RangeSet.of(findInfoBlocks(state), true);
    },
    update(decorations, tr) {
      if (tr.docChanged || tr.selection) {
        return RangeSet.of(findInfoBlocks(tr.state), true);
      }
      return decorations.map(tr.changes);
    },
    provide(field) {
      return EditorView.decorations.from(field);
    },
  });

  const theme = EditorView.theme({
    ".cm-info-block-widget": {
      display: "block",
      margin: "0 !important",
      lineHeight: "1",
    },
  });

  const eventHandlers = EditorView.domEventHandlers({
    mousedown(event, view) {
      const target = event.target as HTMLElement;
      if (target.closest(".cm-info-block-widget")) {
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
