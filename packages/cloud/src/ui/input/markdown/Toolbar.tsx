/**
 * Toolbar button strip for the markdown editor. It uses a single Tab stop and
 * arrow-key navigation so the editor stays efficient without making pointer
 * controls unavailable to keyboard users. Formatting shortcuts remain the
 * fastest path for experienced editors.
 *
 * Buttons display in an active state (blue tint + faint background)
 * when `activeFormats` contains their `id` — feedback that the caret
 * currently sits inside a styled span. The set is computed by
 * `active-formats.ts` and pushed in from the host component.
 */
import { For, type JSX, Show } from "solid-js";
import {
  toggleBold,
  toggleItalic,
  toggleCode,
  insertLink,
  toggleHeading,
  toggleBulletList,
  toggleNumberedList,
  toggleQuote,
} from "./actions";

type ToolbarProps = {
  /** Reactive accessor returning the textarea element (or null before mount). */
  textarea: () => HTMLTextAreaElement | null;
  /** Reactive set of "currently active" format IDs at the caret. The
   * button whose `id` is in the set renders in the active visual state
   * (overtype convention — gives the user feedback that the cursor sits
   * inside a styled span). */
  activeFormats?: () => Set<string>;
  disabled?: boolean;
  /** Host-provided controls rendered right-aligned (e.g. a save button). */
  trailing?: JSX.Element;
};

type Tool = { kind: "btn"; id: string; icon: string; title: string; run: (ta: HTMLTextAreaElement) => void } | { kind: "sep" };

const TOOLS: Tool[] = [
  { kind: "btn", id: "bold", icon: "ti ti-bold", title: "Bold (Ctrl/Cmd+B)", run: toggleBold },
  { kind: "btn", id: "italic", icon: "ti ti-italic", title: "Italic (Ctrl/Cmd+I)", run: toggleItalic },
  { kind: "btn", id: "code", icon: "ti ti-code", title: "Inline code (Ctrl/Cmd+E)", run: toggleCode },
  { kind: "btn", id: "link", icon: "ti ti-link", title: "Link (Ctrl/Cmd+K)", run: (ta) => insertLink(ta) },
  { kind: "sep" },
  { kind: "btn", id: "h1", icon: "ti ti-h-1", title: "Heading 1 (Ctrl/Cmd+Shift+1)", run: (ta) => toggleHeading(ta, 1) },
  { kind: "btn", id: "h2", icon: "ti ti-h-2", title: "Heading 2 (Ctrl/Cmd+Shift+2)", run: (ta) => toggleHeading(ta, 2) },
  { kind: "btn", id: "h3", icon: "ti ti-h-3", title: "Heading 3 (Ctrl/Cmd+Shift+3)", run: (ta) => toggleHeading(ta, 3) },
  { kind: "sep" },
  { kind: "btn", id: "bullet", icon: "ti ti-list", title: "Bullet list (Ctrl/Cmd+Shift+8)", run: toggleBulletList },
  { kind: "btn", id: "ordered", icon: "ti ti-list-numbers", title: "Numbered list (Ctrl/Cmd+Shift+7)", run: toggleNumberedList },
  { kind: "btn", id: "quote", icon: "ti ti-quote", title: "Quote", run: toggleQuote },
];

export default function Toolbar(props: ToolbarProps) {
  let toolbarRef!: HTMLDivElement;

  const moveFocus = (event: KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const actions = Array.from(toolbarRef.querySelectorAll<HTMLButtonElement>(".md-editor-tool:not(:disabled)"));
    if (actions.length === 0) return;
    const current = Math.max(
      0,
      actions.findIndex((action) => action === document.activeElement),
    );
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? actions.length - 1
          : event.key === "ArrowLeft"
            ? (current - 1 + actions.length) % actions.length
            : (current + 1) % actions.length;
    event.preventDefault();
    for (const action of actions) action.tabIndex = -1;
    actions[next]!.tabIndex = 0;
    actions[next]!.focus();
  };

  return (
    <div ref={toolbarRef} class="md-editor-toolbar" role="toolbar" aria-label="Markdown formatting" onKeyDown={moveFocus}>
      <For each={TOOLS}>
        {(tool, index) =>
          tool.kind === "sep" ? (
            <span class="md-editor-tool-sep" aria-hidden="true" />
          ) : (
            <button
              type="button"
              class="md-editor-tool"
              title={tool.title}
              aria-label={tool.title}
              aria-pressed={props.activeFormats?.().has(tool.id) ? "true" : undefined}
              disabled={props.disabled}
              tabIndex={index() === 0 ? 0 : -1}
              // Prevent the button from stealing focus from the textarea —
              // we want the textarea to stay focused so the cursor stays
              // visible during action.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const ta = props.textarea();
                if (ta) tool.run(ta);
              }}
            >
              <i class={tool.icon} />
            </button>
          )
        }
      </For>
      <Show when={props.trailing}>
        <span class="ml-auto inline-flex items-center gap-0.5">{props.trailing}</span>
      </Show>
    </div>
  );
}
