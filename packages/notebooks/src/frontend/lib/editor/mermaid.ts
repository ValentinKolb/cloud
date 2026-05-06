import { syntaxTree } from "@codemirror/language";
import { RangeSet, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { EditorState, Extension, Range } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import mermaid from "mermaid";

let isMermaidInitialized = false;

const initializeMermaid = () => {
  if (isMermaidInitialized) return;
  if (typeof window === "undefined" || typeof document === "undefined") return;

  mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    suppressErrorRendering: true,
    themeVariables: {
      fontFamily: "IBM Plex Mono",
      fontSize: "10px",
      // Keep full hex values to avoid shorthand parsing issues in strict Mermaid builds.
      textColor: "#111827",
      lineColor: "#6b7280",
      primaryTextColor: "#111827",
      secondaryTextColor: "#111827",
      tertiaryTextColor: "#111827",
      noteTextColor: "#111827",
      mainBkg: "#ffffff",
      secondBkg: "#f9fafb",
      tertiaryColor: "#f3f4f6",
    },
  });

  isMermaidInitialized = true;
};

const globalSvgCache = new Map<string, { svg: string; timestamp: number }>();
const renderTimers = new Map<string, NodeJS.Timeout>();

interface MermaidBlockParams {
  code: string;
  id: string;
}

class MermaidWidget extends WidgetType {
  private code: string;
  private id: string;
  private cacheKey: string;

  constructor({ code, id }: MermaidBlockParams) {
    super();
    this.code = code;
    this.id = `mermaid-${id}`;
    this.cacheKey = this.generateCacheKey(code);
  }

  private generateCacheKey(code: string): string {
    let hash = 0;
    for (let i = 0; i < code.length; i++) {
      const char = code.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return `mermaid-${hash}`;
  }

  override eq(other: MermaidWidget) {
    return other.code === this.code;
  }

  override toDOM() {
    const container = document.createElement("div");
    container.className = "cm-mermaid-widget !m-0";

    const wrapper = document.createElement("div");
    wrapper.className =
      "my-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-700 p-4 overflow-auto flex items-center justify-center";
    wrapper.style.height = "min(30vh, 400px)";
    wrapper.style.minHeight = "200px";

    const renderDiv = document.createElement("div");
    renderDiv.id = this.id;
    renderDiv.className = "flex justify-center items-center w-full h-full";

    const cached = globalSvgCache.get(this.cacheKey);
    if (cached && cached.svg) {
      renderDiv.innerHTML = cached.svg;
      const svgElement = renderDiv.querySelector("svg");
      if (svgElement) {
        svgElement.style.maxWidth = "90%";
        svgElement.style.maxHeight = "90%";
        svgElement.style.width = "auto";
        svgElement.style.height = "auto";
        svgElement.style.objectFit = "contain";
      }
    } else {
      renderDiv.innerHTML = `
        <div class="flex items-center gap-2 text-gray-500">
          <i class="ti ti-loader animate-spin"></i>
          <span class="text-sm">Loading diagram...</span>
        </div>`;
    }

    wrapper.appendChild(renderDiv);
    container.appendChild(wrapper);
    this.debouncedRender(renderDiv);
    return container;
  }

  private debouncedRender(element: HTMLElement) {
    const existingTimer = renderTimers.get(this.cacheKey);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(() => {
      this.renderDiagram(element);
      renderTimers.delete(this.cacheKey);
    }, 500);

    renderTimers.set(this.cacheKey, timer);
  }

  private async renderDiagram(element: HTMLElement) {
    try {
      initializeMermaid();
      const cached = globalSvgCache.get(this.cacheKey);
      const now = Date.now();
      const renderId = `${this.id}-${Date.now()}`;
      const { svg } = await mermaid.render(renderId, this.code);

      globalSvgCache.set(this.cacheKey, { svg, timestamp: now });

      if (globalSvgCache.size > 50) {
        const oldestKey = Array.from(globalSvgCache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp)[0]![0];
        globalSvgCache.delete(oldestKey);
      }

      if (!cached || cached.svg !== svg) {
        element.innerHTML = svg;
        element.className = "flex justify-center items-center w-full h-full";
        const svgElement = element.querySelector("svg");
        if (svgElement) {
          svgElement.style.maxWidth = "90%";
          svgElement.style.maxHeight = "90%";
          svgElement.style.width = "auto";
          svgElement.style.height = "auto";
          svgElement.style.objectFit = "contain";
        }
      }
    } catch (error) {
      element.innerHTML = `
        <div class="flex flex-col items-center gap-2 text-red-500 p-4">
          <i class="ti ti-alert-circle text-2xl"></i>
          <span class="text-sm font-mono">Invalid mermaid syntax</span>
          <details class="text-xs text-gray-500 max-w-full">
            <summary class="cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">Show error details</summary>
            <pre class="mt-2 p-2 bg-gray-100 dark:bg-gray-800 rounded text-left overflow-x-auto">${
              error instanceof Error ? error.message : String(error)
            }</pre>
          </details>
        </div>`;
    }
  }

  override ignoreEvent() {
    return false;
  }
}

export const mermaidExtension = (): Extension => {
  const mermaidBlockDecoration = (params: MermaidBlockParams) =>
    Decoration.widget({
      widget: new MermaidWidget(params),
      side: -1,
      block: true,
    });

  const decorate = (state: EditorState) => {
    const widgets: Range<Decoration>[] = [];
    let widgetId = 0;

    syntaxTree(state).iterate({
      enter: ({ type, from, to }) => {
        if (type.name === "FencedCode") {
          const text = state.doc.sliceString(from, to);
          const lines = text.split("\n");
          const language = lines[0]?.replace("```", "").trim().toLowerCase() || "";

          if (language === "mermaid") {
            const code = lines.slice(1, -1).join("\n");
            widgets.push(
              mermaidBlockDecoration({
                code,
                id: `${from}-${widgetId++}`,
              }).range(state.doc.lineAt(from).from),
            );
          }
        }
      },
    });

    return widgets.length > 0 ? RangeSet.of(widgets) : Decoration.none;
  };

  const mermaidField = StateField.define<DecorationSet>({
    create(state) {
      return decorate(state);
    },
    update(decorations, transaction) {
      if (transaction.docChanged) return decorate(transaction.state);
      return decorations.map(transaction.changes);
    },
    provide(field) {
      return EditorView.decorations.from(field);
    },
  });

  return [mermaidField];
};
