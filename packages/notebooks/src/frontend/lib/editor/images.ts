import { syntaxTree } from "@codemirror/language";
import { StateField, RangeSet } from "@codemirror/state";
import type { EditorState, Extension, Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { buildAttachmentContentUrl, confirmAndDownload, extractAttachmentId } from "./attachment-url";

/** Match the optional `=WxH` size suffix Pandoc-style image syntax allows. */
const SIZE_SUFFIX_REGEX = /\s+=(\d+)?x(\d+)?$/;

type ParsedImage = {
  url: string;
  width: string | null;
  height: string | null;
};

const parseImageHref = (href: string): ParsedImage => {
  const match = SIZE_SUFFIX_REGEX.exec(href);
  if (!match) return { url: href, width: null, height: null };
  return {
    url: href.slice(0, match.index),
    width: match[1] ?? null,
    height: match[2] ?? null,
  };
};

/** `attach://<shortId>` → `/api/notebooks/<nbid>/attachments/<shortId>/content`. */
const resolveUrl = (rawUrl: string, notebookId: string): string => {
  const id = extractAttachmentId(rawUrl);
  return id ? buildAttachmentContentUrl(notebookId, id) : rawUrl;
};

class ImageWidget extends WidgetType {
  constructor(
    private url: string,
    private alt: string,
    private width: string | null,
    private height: string | null,
  ) {
    super();
  }

  override toDOM() {
    const container = document.createElement("div");
    container.className = "cm-image-widget my-2 cursor-pointer";
    container.setAttribute("contenteditable", "false");
    container.setAttribute("tabindex", "0");

    const figure = document.createElement("figure");
    figure.className = "flex flex-col items-center justify-center max-w-full";

    const img = document.createElement("img");
    // Drop the `max-h-[400px]` cap when an explicit size is requested so
    // the user's `=WxH` actually wins.
    img.className =
      this.width || this.height
        ? "block rounded border border-gray-200 dark:border-gray-700"
        : "block max-h-[400px] rounded border border-gray-200 dark:border-gray-700";
    img.src = this.url;
    img.alt = this.alt || "";
    img.loading = "lazy";
    if (this.width) {
      img.setAttribute("width", this.width);
      img.style.maxWidth = `${this.width}px`;
    }
    if (this.height) img.setAttribute("height", this.height);

    if (this.alt) {
      const caption = document.createElement("figcaption");
      caption.className = "text-sm text-gray-500 dark:text-gray-400 mt-2 italic";
      caption.textContent = this.alt;
      figure.appendChild(img);
      figure.appendChild(caption);
    } else {
      figure.appendChild(img);
    }

    container.appendChild(figure);

    // Click → download confirm. Stop propagation so CM doesn't reposition
    // the cursor (consistent with the file-pill widget).
    container.onmousedown = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    container.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      void confirmAndDownload(this.alt || "image", this.url);
    };

    return container;
  }

  override eq(other: WidgetType) {
    return (
      other instanceof ImageWidget &&
      other.url === this.url &&
      other.alt === this.alt &&
      other.width === this.width &&
      other.height === this.height
    );
  }

  override ignoreEvent(event: Event) {
    return event.type !== "mousedown";
  }
}

type ImageRange = { from: number; to: number };
type ImagesState = {
  decorations: DecorationSet;
  /** Source-byte ranges of every Image node (incl. the next-line
   *  source-visible extension). Used by `update()` to gate
   *  rebuilds on cursor-boundary crossings. */
  imageRanges: ImageRange[];
};

const cursorImageKey = (state: EditorState, ranges: ImageRange[]): number | null => {
  if (ranges.length === 0) return null;
  const cursor = state.selection.main;
  for (const r of ranges) {
    if (cursor.from >= r.from && cursor.to <= r.to) return r.from;
  }
  return null;
};

const findMarkdownImages = (state: EditorState, notebookId: string): ImagesState => {
  const decorations: Range<Decoration>[] = [];
  const imageRanges: ImageRange[] = [];
  const cursor = state.selection.ranges[0]!;

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.type.name !== "Image") return;

      const nextLine = state.doc.lineAt(Math.min(node.to + 1, state.doc.length));
      imageRanges.push({ from: node.from, to: nextLine.to });
      if (cursor.from >= node.from && cursor.to <= nextLine.to) return false;

      const text = state.sliceDoc(node.from, node.to);
      const match = text.match(/!\[([^\]]*)\]\(([^)]+)\)/);

      if (match) {
        const alt = match[1] ?? "";
        const rawHref = match[2] ?? "";
        const { url, width, height } = parseImageHref(rawHref);
        decorations.push(
          Decoration.replace({
            widget: new ImageWidget(resolveUrl(url, notebookId), alt, width, height),
            block: true,
          }).range(node.from, node.to),
        );
      }
    },
  });

  return {
    decorations: decorations.length > 0 ? RangeSet.of(decorations, true) : Decoration.none,
    imageRanges,
  };
};

export const imageExtension = (notebookId: string): Extension => {
  const stateField = StateField.define<ImagesState>({
    create(state) {
      return findMarkdownImages(state, notebookId);
    },
    update(value, tr) {
      if (tr.docChanged) {
        return findMarkdownImages(tr.state, notebookId);
      }
      if (!tr.selection) {
        return value;
      }
      const oldKey = cursorImageKey(tr.startState, value.imageRanges);
      const newKey = cursorImageKey(tr.state, value.imageRanges);
      if (oldKey === newKey) {
        return value;
      }
      return findMarkdownImages(tr.state, notebookId);
    },
    provide(field) {
      return EditorView.decorations.from(field, (v) => v.decorations);
    },
  });

  const theme = EditorView.theme({
    ".cm-image-widget": {
      display: "block",
      margin: "0 !important",
      lineHeight: "1",
    },
    ".cm-image-widget:focus": {
      outline: "2px solid var(--color-blue-500)",
      outlineOffset: "2px",
      borderRadius: "4px",
    },
  });

  // No view-level mousedown handler needed — the widget container swallows
  // its own clicks (preventDefault + stopPropagation in toDOM).
  return [stateField, theme];
};
