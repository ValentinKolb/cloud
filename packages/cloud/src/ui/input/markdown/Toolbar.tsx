/**
 * Toolbar button strip for the markdown editor. Mouse-only by design:
 * each button has `tabIndex=-1` so Tab navigates AROUND the editor's
 * toolbar straight to the textarea body. Keyboard users get the same
 * actions via `Cmd/Ctrl + B/I/E/K` and the shift-digit shortcuts.
 *
 * Buttons display in an active state (blue tint + faint background)
 * when `activeFormats` contains their `id` — feedback that the caret
 * currently sits inside a styled span. The set is computed by
 * `active-formats.ts` and pushed in from the host component.
 */
import { For } from "solid-js";
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
  return (
    <div class="md-editor-toolbar" role="toolbar" aria-label="Markdown formatting">
      <For each={TOOLS}>
        {(tool) =>
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
              // tabIndex=-1 so Tab doesn't land on 10 formatting buttons
              // before reaching the editor body. Keyboard users have all
              // the same actions available via Cmd/Ctrl shortcuts; the
              // toolbar stays a mouse-friendly affordance.
              tabIndex={-1}
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
    </div>
  );
}
