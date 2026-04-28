import { syntaxTree } from "@codemirror/language";
import { RangeSet, StateField } from "@codemirror/state";
import type { EditorState, Extension, Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";

type LinkData = {
  label: string;
  url: string;
};

class LinkWidget extends WidgetType {
  constructor(private linkData: LinkData) {
    super();
  }

  override toDOM() {
    const container = document.createElement("span");
    container.className = "cm-link-widget";

    const labelSpan = document.createElement("span");
    labelSpan.className = "cm-link-label font-bold text-gray-800 dark:text-gray-200";
    labelSpan.textContent = `[${this.linkData.label}]`;

    const iconSpan = document.createElement("span");
    iconSpan.className =
      "cm-link-icon cursor-pointer mb-0.25 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-500 hover:underline";
    iconSpan.innerHTML = '<i class="ti ti-arrow-up-right text-xs"></i>';
    iconSpan.title = this.linkData.url;

    iconSpan.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.open(this.linkData.url, "_blank", "noopener,noreferrer");
    };

    container.appendChild(labelSpan);
    container.appendChild(iconSpan);
    return container;
  }

  override eq(other: WidgetType) {
    return other instanceof LinkWidget && other.linkData.label === this.linkData.label && other.linkData.url === this.linkData.url;
  }

  override ignoreEvent(event: Event) {
    const target = event.target as HTMLElement;
    return target.closest(".cm-link-icon") !== null;
  }
}

const parseLinkSyntax = (text: string): LinkData | null => {
  const match = text.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  if (!match || !match[1] || !match[2]) return null;
  return { label: match[1], url: match[2] };
};

const findLinks = (state: EditorState): Range<Decoration>[] => {
  const decorations: Range<Decoration>[] = [];
  const cursor = state.selection.ranges[0]!;

  syntaxTree(state).iterate({
    enter: ({ type, from, to }) => {
      if (type.name !== "Link") return;
      if (cursor.from >= from && cursor.to <= to) return;

      const text = state.doc.sliceString(from, to);
      const linkData = parseLinkSyntax(text);

      if (linkData) {
        decorations.push(Decoration.replace({ widget: new LinkWidget(linkData) }).range(from, to));
      }
    },
  });

  return decorations;
};

export const linksExtension = (): Extension => {
  const stateField = StateField.define<DecorationSet>({
    create(state) {
      return RangeSet.of(findLinks(state), true);
    },
    update(decorations, tr) {
      if (tr.docChanged || tr.selection) {
        return RangeSet.of(findLinks(tr.state), true);
      }
      return decorations.map(tr.changes);
    },
    provide(field) {
      return EditorView.decorations.from(field);
    },
  });

  const theme = EditorView.theme({
    ".cm-link-widget": {
      display: "inline-flex",
      alignItems: "center",
      verticalAlign: "baseline",
    },
    ".cm-link-label": {
      fontFamily: "inherit",
      fontSize: "inherit",
    },
    ".cm-link-icon": {
      display: "inline-flex",
      alignItems: "center",
      opacity: "0.7",
      transition: "opacity 0.2s",
    },
    ".cm-link-widget:hover .cm-link-icon": {
      opacity: "1",
    },
  });

  const eventHandlers = EditorView.domEventHandlers({
    mousedown(event, view) {
      const target = event.target as HTMLElement;
      if (target.closest(".cm-link-label")) {
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
