/**
 * `\`\`\`script` block extension for the rich-mode CodeMirror editor.
 *
 * Markdown body authoring contract:
 *
 *   ```script
 *   kit.ui.button("Hello", () => kit.ui.toast(kit.note.title));
 *   ```
 *
 * What this extension does:
 *  - Walks the syntax tree for `FencedCode` nodes whose info-string
 *    is `script`, evaluates them as `async (kit) => { ... }`, and
 *    mounts each block's UI output into a `.md-script-output`
 *    widget BELOW the source fence.
 *  - Re-runs are debounced (~500 ms quiet) so rapid keystrokes inside
 *    a script don't thrash the kit / DOM. Edits OUTSIDE a script
 *    block (or in a different script block) don't trigger a rerun
 *    of the unrelated block — `eq()` keeps stable widgets stable.
 *  - The `scriptsEnabled` flag is checked synchronously at decoration
 *    time. When OFF, no widgets are emitted; the source renders as a
 *    plain code-fence like any other.
 *
 * The read-mode equivalent lives in
 * `service/scripts.ts:transformScripts` — same engine
 * (`lib/script/runner.ts`) drives both paths so authoring + viewing
 * stay byte-identical.
 */
import { syntaxTree } from "@codemirror/language";
import { RangeSet, StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { createKit } from "../script/kit";
import { runScript } from "../script/runner";

/** Per-notebook config the extension needs to run scripts. The
 *  fields are functions (rather than values) so the extension picks
 *  up changes — `scriptsEnabled` flips at runtime via the settings
 *  panel; `noteTitle` updates when the user renames the note. */
export type ScriptsConfig = {
  scriptsEnabled: () => boolean;
  noteTitle: () => string;
  /** Optional toast surface — when omitted the kit logs to console. */
  toast?: (message: string) => void;
};

/** Debounce window for re-runs after a source change. Picked at
 *  500 ms because: (a) AsyncFunction parse + execute on small bodies
 *  is sub-ms, but (b) future kit calls (Phase 2) hit the network /
 *  Y.Doc, and (c) the user rarely needs sub-500 ms feedback while
 *  TYPING the script — most edits land settled. */
const RERUN_DEBOUNCE_MS = 500;

/**
 * Block widget: hosts the `.md-script-output` container and runs the
 * script into it on a debounced timer.
 *
 * Lifecycle:
 *  - `toDOM` is called once per widget instance. We schedule the run
 *    via `setTimeout(RERUN_DEBOUNCE_MS)` rather than running
 *    synchronously. This gives the user typing-noise immunity:
 *    rapid keystrokes spawn many short-lived widgets, but only the
 *    LATEST instance's timer survives long enough to fire.
 *  - When the user edits the source, CodeMirror builds a NEW widget
 *    with the new source, removes the old DOM, and calls `destroy`
 *    on the old widget. We clear the old timer there — pending runs
 *    on stale widgets would otherwise fire into detached DOM and
 *    waste cycles (harmless but ugly).
 *  - On first mount (note open) the same debounce applies — there's
 *    no "first render is instant" carve-out because adding one
 *    branches the state machine and 500 ms is below typical
 *    page-paint perception anyway.
 */
class ScriptOutputWidget extends WidgetType {
  private container: HTMLElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly source: string,
    private readonly config: ScriptsConfig,
  ) {
    super();
  }

  override eq(other: WidgetType): boolean {
    return other instanceof ScriptOutputWidget && other.source === this.source;
  }

  override toDOM(): HTMLElement {
    const container = document.createElement("div");
    container.className = "md-script-output";
    this.container = container;
    this.scheduleRun();
    return container;
  }

  override destroy(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.container = null;
  }

  /** Schedule a debounced run. Replaces any pending run on the same
   *  widget instance — that's just defensive, since each widget only
   *  schedules once via `toDOM`. */
  private scheduleRun(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.run();
    }, RERUN_DEBOUNCE_MS);
  }

  private run(): void {
    if (!this.container) return;
    // Bail if the container was detached between scheduling and
    // firing — the widget got destroyed but the timer somehow
    // survived (defensive; `destroy` clears it).
    if (!this.container.isConnected) return;
    // Clear previous render so re-runs don't accumulate buttons /
    // duplicate output. (No-op on first run.)
    this.container.replaceChildren();
    const kit = createKit({
      noteTitle: this.config.noteTitle(),
      outputEl: this.container,
      toast: this.config.toast,
    });
    void runScript(this.source, kit, this.container);
  }
}

/**
 * Extract the language tag and body of a `FencedCode` node by walking
 * its Lezer-markdown children. This is the same lexer the markdown
 * preview pipeline uses, so accepts every variant `marked` accepts:
 *   - 3+ backtick fences  (` ``` `, ` ```` `, …)
 *   - 3+ tilde fences     (`~~~`, `~~~~`, …)
 *   - up to 3 leading spaces of indentation
 *   - missing closing fence (mid-edit) — body extends to EOF
 *
 * Why not string-split: codex review on commit 14642fc flagged that
 * CM's `state.doc.sliceString(from, to)` + a hand-rolled
 * `replace(/^```/, '')` only handles the most common form. Variants
 * like `~~~script` or `    \`\`\`\`script` would be evaluated by
 * read-mode (marked sees them as `lang: "script"`) but skipped by
 * the editor — silent drift between authoring and rendering.
 *
 * `node` MUST be the `FencedCode` node itself — not a cursor /
 * resolved position. Resolving via `tree.cursorAt(from, 1)` would
 * land on the opening `CodeMark` (no children), which would make
 * `firstChild()` return false and silently skip every block. We pull
 * the SyntaxNode straight from `iterate`'s `nodeRef.node` to avoid
 * that trap (codex review on commit 972e16e).
 *
 * Returns null when the fence isn't a `script` block.
 */
type FenceParts = { body: string };

const parseScriptFence = (state: EditorState, node: SyntaxNode): FenceParts | null => {
  let info: string | null = null;
  // Body spans the union of every `CodeText` child range. The grammar
  // emits one `CodeText` per body line in some variants, so we have
  // to collect the full span from the first to the last.
  let bodyFrom: number | null = null;
  let bodyTo: number | null = null;

  let child: SyntaxNode | null = node.firstChild;
  while (child) {
    const name = child.name;
    if (name === "CodeInfo" && info === null) {
      info = state.doc.sliceString(child.from, child.to).trim().toLowerCase();
    } else if (name === "CodeText") {
      if (bodyFrom === null) bodyFrom = child.from;
      bodyTo = child.to;
    }
    child = child.nextSibling;
  }

  if (info !== "script") return null;
  // Empty body (just `\`\`\`script\n\`\`\``) — let the runner render
  // an empty output. No filter here.
  const body = bodyFrom !== null && bodyTo !== null ? state.doc.sliceString(bodyFrom, bodyTo) : "";
  return { body };
};

/**
 * Walk the document syntax tree, find every `\`\`\`script` block, and
 * emit a block widget below each one. Synchronous — runs on every
 * doc-changed transaction. The widget's `eq()` keeps DOM stable
 * across unrelated edits.
 */
const decorate = (state: EditorState, config: ScriptsConfig): DecorationSet => {
  if (!config.scriptsEnabled()) return Decoration.none;

  const widgets: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter: (nodeRef) => {
      if (nodeRef.type.name !== "FencedCode") return;
      const parts = parseScriptFence(state, nodeRef.node);
      if (!parts) return;
      const widget = new ScriptOutputWidget(parts.body, config);
      const blockEnd = state.doc.lineAt(nodeRef.to).to;
      widgets.push(
        Decoration.widget({
          widget,
          side: 1,
          block: true,
        }).range(blockEnd),
      );
    },
  });
  return widgets.length > 0 ? RangeSet.of(widgets) : Decoration.none;
};

/**
 * Returns the CodeMirror extension that wires up `\`\`\`script`
 * widgets. Mount alongside the other editor extensions in
 * `NoteEditor.client.tsx`.
 *
 * Debounce: the StateField re-decorates on every doc-changed
 * transaction (so the widget tree stays in sync). A cheap built-in
 * debounce is achieved by `eq()` — when the user is typing INSIDE
 * a script block, every keystroke produces a different source string
 * → different widget → CM rebuilds DOM → `toDOM` runs the script
 * fresh. To slow that down for expensive scripts, the runner itself
 * could grow a settle-delay; for Phase 1 (small kit surface, sub-ms
 * runs) we accept the immediate rebuild.
 */
export const scriptsExtension = (config: ScriptsConfig): Extension => {
  const field = StateField.define<DecorationSet>({
    create: (state) => decorate(state, config),
    update: (decorations, tx) => {
      if (tx.docChanged) return decorate(tx.state, config);
      // Non-doc changes (selection, focus) don't affect script
      // widgets — keep the same decoration set, mapped through any
      // changes (none in this branch but harmless).
      return decorations.map(tx.changes);
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  return [field];
};
