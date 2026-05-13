/**
 * `\`\`\`script` block extension for the rich-mode CodeMirror editor.
 *
 * Markdown body authoring contract:
 *
 *   ```script
 *   kit.ui.button("Hello", () => kit.ui.toast(kit.note.title));
 *   ```
 *
 * # Architecture — minimal, mirrors the homepage app's `code` ext
 *
 * Each `\`\`\`script` block gets ONE additive output `Decoration.widget`
 * anchored at the end of the closing-fence line with `side: 1` as an
 * inline widget. CSS makes the widget visually block-level. The widget
 * hosts the kit-driven UI (buttons, toasts, error blocks). The source
 * stays visible while the cursor is in or near the fence; otherwise
 * the source range is collapsed with the same table-style replace /
 * atomic-ranges pattern and the output frame's header becomes the
 * visible "Script" affordance.
 *
 * No `requestMeasure`, no fold support — every previous attempt at
 * auto-folding caused the "ArrowUp jumps to a random script block"
 * regression. Source collapsing is table-style `Decoration.replace`
 * with a zero-height placeholder and atomic ranges; the runtime output
 * remains the stable inline widget below the fence.
 *
 * # Output widget — runtime isolation
 *
 * - `updateDOM()` reuses the output DOM and only re-runs when the
 *   source changes. Positional shifts update header metadata without
 *   re-invoking the script.
 * - `contenteditable=false` on the widget root keeps CM6's
 *   MutationObserver out of the kit's runtime DOM mutations
 *   (kit.ui.button, error blocks, toasts). Without this, those
 *   mutations get misinterpreted as user edits and corrupt the
 *   script body.
 * - `ignoreEvent` returns true — clicks on internal buttons stay
 *   self-contained; CM doesn't try to caret-move on them.
 * - `disposed` flag handles the late-registration race for async
 *   scripts that `await` before subscribing via
 *   `kit.state.observe`.
 * - `runId` guards stale async runs. We can't cancel an already
 *   executing AsyncFunction, but late kit side effects from old
 *   source are rejected after a re-run/destroy.
 *
 * # Read-mode parallel
 *
 * The read-mode equivalent lives in `lib/script/read-mode.ts` —
 * same engine (`lib/script/runner.ts`) drives both paths so authoring
 * + viewing stay byte-identical.
 */
import { syntaxTree } from "@codemirror/language";
import { Prec, RangeSet, StateField, type EditorState, type Extension, type Range, type Transaction } from "@codemirror/state";
import { Decoration, EditorView, keymap, WidgetType, type DecorationSet } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import type * as Y from "yjs";
import { createKit } from "../script/kit";
import type { KitNoteSnapshot } from "../script/kit";
import { runScript } from "../script/runner";

/** Per-notebook config the extension needs to run scripts. The
 *  fields are functions (rather than values) so the extension picks
 *  up changes — `scriptsEnabled` flips at runtime via the settings
 *  panel; the snapshot getter reflects the current note metadata
 *  at the moment a script is run.
 *
 *  `notebookId` is the user-visible short-id (6-char base62). The
 *  kit uses it both as the `:id` param for API calls (notebooks
 *  API accepts either UUID or short-id) and as the value of
 *  `kit.note.notebook.id` exposed to script authors. */
export type ScriptsConfig = {
  scriptsEnabled: () => boolean;
  notebookId: string;
  /** Snapshot of the current note at script-run time. The factory
   *  re-reads this getter every run, so renames / locks are picked
   *  up on the next debounced re-evaluation. */
  noteSnapshot: () => KitNoteSnapshot;
  /** Live Y.Text for the current note's content — kit writes
   *  mutate this directly. */
  ytext: Y.Text;
  /** Y.Doc for the current note — feeds `kit.state.*`. */
  ydoc: Y.Doc;
};

/** Debounce window for re-runs after a source change. Keep it above
 *  normal typing cadence: showcase scripts often perform several API
 *  calls and rebuild a large output tree, so re-running after every
 *  slow keystroke makes the editor feel like the keystroke itself is
 *  delayed. */
const RERUN_DEBOUNCE_MS = 1200;

// =============================================================================
// Output widget — visually block-level widget below the script
// =============================================================================

/**
 * Inline widget that hosts the `.md-script-output` container the kit
 * renders into. CSS gives it `display: block`, but CM still sees the
 * enclosing line as text, which keeps cursor movement stable.
 *
 * # DOM reuse via `updateDOM` — critical for typing perf
 *
 * Every keystroke INSIDE a script fence changes the source, which
 * means `eq()` returns false against the previous widget instance.
 * Without intervention CM would call `destroy(oldDom)` + `toDOM()`
 * for every keystroke — tearing down the output DOM, running all
 * disposers (kvStore.watch unsubs, ymap unobserves), and rebuilding
 * fresh divs. Even though the user script itself is debounced 500ms,
 * the destroy/create cycle alone is enough to make typing visibly
 * laggy in a doc with several scripts.
 *
 * Fix: implement `updateDOM(dom)` to opt into CM's same-type-widget
 * DOM reuse path. When `updateDOM` returns true, CM keeps the
 * existing DOM and skips `destroy`. We stash the per-DOM run state
 * (timer, disposers, output/error refs, runId, scriptIndex) on the
 * dom element itself via a symbol key, so successive widget
 * instances all schedule runs against the same persistent state.
 * The first run starts immediately after the widget mounts; later
 * source changes only re-arm the debounce timer. No DOM teardown
 * happens until the widget is actually removed (script deleted /
 * editor unmounted) or it migrates to a different `scriptIndex`
 * (defensive guard against CM matching the wrong decoration).
 */

/** Per-DOM run state. Lives on the widget's root element via the
 *  symbol key below so it survives widget-instance churn (source
 *  edits create new widgets every keystroke; the DOM and its state
 *  are reused). */
type WidgetRunState = {
  source: string;
  metaEl: HTMLElement;
  outputEl: HTMLElement;
  errorEl: HTMLElement;
  /** Pending debounce timer for the next script execution. */
  timer: ReturnType<typeof setTimeout> | null;
  /** Disposers registered by the most recent successful run. Re-run
   *  fires them BEFORE registering new ones. */
  disposers: Array<() => void>;
  /** True once the dom is permanently torn down (CM `destroy`).
   *  Late async callbacks check this to short-circuit. */
  disposed: boolean;
  /** Bumped on every run + on destroy. Lets async callbacks tell
   *  whether they're a leftover from an earlier run. */
  runId: number;
  /** Index of the script this state belongs to. If CM ever calls
   *  `updateDOM` across mismatched indices we refuse and force a
   *  rebuild (defense against CM matching the wrong decoration when
   *  scripts are added/removed). */
  scriptIndex: number;
};

const RUN_STATE_KEY = Symbol("kit-script-run-state");

type DomWithState = HTMLElement & { [RUN_STATE_KEY]?: WidgetRunState };
const formatScriptLineCount = (lineCount: number): string =>
  `${lineCount} ${lineCount === 1 ? "line" : "lines"}`;

class OutputWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly config: ScriptsConfig,
    private readonly fromPos: number,
    private readonly lineCount: number,
    /** Positional index of this script block within the document
     *  (0 for the first `\`\`\`script` fence, 1 for the second, …).
     *  Included in `eq()` so CM treats two scripts with the SAME
     *  source body at DIFFERENT positions as distinct decorations.
     *  Without this, pasting an identical script twice would make
     *  CM's diff algorithm conflate them (both widgets are eq() to
     *  each other) — observed as a complete tab freeze on the second
     *  paste. */
    private readonly scriptIndex: number,
  ) {
    super();
  }

  override eq(other: WidgetType): boolean {
    // Source, source position, line count, and positional index. Any
    // change should give `updateDOM()` a chance to refresh header
    // metadata or schedule a source re-run while still keeping the
    // DOM alive.
    return (
      other instanceof OutputWidget &&
      other.source === this.source &&
      other.fromPos === this.fromPos &&
      other.lineCount === this.lineCount &&
      other.scriptIndex === this.scriptIndex
    );
  }

  override get lineBreaks(): number {
    // CRITICAL — without this, ArrowDown from the closing-fence line
    // gets stuck before the widget. Reason: this is an INLINE widget
    // (block: false) styled `display: block` in CSS. CM6 treats it
    // as part of the closing-fence line for cursor purposes, so the
    // visual block we render isn't a "next line" cursor can move to;
    // moveVertically lands at the same end-of-line position. Setting
    // `lineBreaks: 1` tells CM the widget introduces one logical
    // line break, so vertical navigation routes the caret PAST the
    // widget (to the start of the next real line) instead of into
    // it. Per CM docs (`@codemirror/view` WidgetType.lineBreaks):
    // "for inline widgets that introduce line breaks (through <br>
    // tags or textual newlines), this must indicate the amount of
    // line breaks they introduce". Our `display: block` widget is
    // morally equivalent to a `<br>` so lineBreaks=1 fits.
    return 1;
  }

  override toDOM(): HTMLElement {
    const root = document.createElement("div") as DomWithState;
    root.className = "md-script-block cm-script-output-frame";
    root.setAttribute("contenteditable", "false");

    const header = document.createElement("div");
    header.className = "cm-script-output-header";

    const icon = document.createElement("i");
    icon.className = "ti ti-code text-sm";

    const label = document.createElement("span");
    label.className = "cm-script-output-title";
    label.textContent = "Script";

    const meta = document.createElement("span");
    meta.className = "cm-script-output-meta";
    meta.textContent = formatScriptLineCount(this.lineCount);

    header.append(icon, label, meta);
    root.appendChild(header);

    const output = document.createElement("div");
    output.className = "md-script-output";
    root.appendChild(output);

    const errors = document.createElement("div");
    errors.className = "md-script-errors";
    root.appendChild(errors);

    const state: WidgetRunState = {
      source: this.source,
      metaEl: meta,
      outputEl: output,
      errorEl: errors,
      timer: null,
      disposers: [],
      disposed: false,
      runId: 0,
      scriptIndex: this.scriptIndex,
    };
    root[RUN_STATE_KEY] = state;
    this.scheduleRun(state, 0);
    return root;
  }

  /**
   * Hook into CM's same-type-widget DOM-reuse path. Called when the
   * new widget's `eq()` returned false but the widget classes match.
   * Returning `true` tells CM to keep the existing DOM and skip
   * `destroy` — we just re-arm the debounce timer with the new
   * source. This turns the per-keystroke cost of "tear down +
   * rebuild divs + run all disposers" into "clearTimeout +
   * setTimeout", which is what makes typing inside script fences
   * feel native.
   *
   * Refuses the reuse if `scriptIndex` doesn't match — defensive
   * guard for the (rare) case where CM matches a leftover
   * decoration from an unrelated script position.
   */
  override updateDOM(dom: HTMLElement): boolean {
    const state = (dom as DomWithState)[RUN_STATE_KEY];
    if (!state || state.disposed) return false;
    if (state.scriptIndex !== this.scriptIndex) return false;
    state.metaEl.textContent = formatScriptLineCount(this.lineCount);
    if (state.source !== this.source) {
      state.source = this.source;
      this.scheduleRun(state);
    }
    return true;
  }

  override destroy(dom: HTMLElement): void {
    const state = (dom as DomWithState)[RUN_STATE_KEY];
    if (!state) return;
    state.disposed = true;
    state.runId++;
    if (state.timer !== null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    this.runDisposers(state);
  }

  override ignoreEvent(): boolean {
    return true;
  }

  private runDisposers(state: WidgetRunState): void {
    for (const fn of state.disposers) {
      try {
        fn();
      } catch (err) {
        console.error("[kit dispose]", err);
      }
    }
    state.disposers = [];
  }

  private scheduleRun(state: WidgetRunState, delayMs = RERUN_DEBOUNCE_MS): void {
    if (state.timer !== null) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = null;
      this.run(state);
    }, delayMs);
  }

  private run(state: WidgetRunState): void {
    if (state.disposed) return;
    if (!state.outputEl.isConnected) return;
    state.runId++;
    const runId = state.runId;
    const isActive = () => !state.disposed && state.runId === runId && state.outputEl.isConnected;
    this.runDisposers(state);
    // Clear BOTH containers on every fresh run — old output and
    // old errors shouldn't bleed across re-evaluations.
    state.outputEl.replaceChildren();
    state.errorEl.replaceChildren();

    // Defense in depth: wrap the kit + run-script setup in a
    // try/catch so any failure during widget-side preparation
    // (kit factory throws, console proxy init throws, etc.) is
    // surfaced as a visible error chip rather than silently
    // bringing down the widget. `runScript` itself already catches
    // user-script errors and renders them into `errorEl`; this
    // outer guard only catches the rare framework-side failure.
    try {
      const kit = createKit({
        mode: "edit",
        notebookId: this.config.notebookId,
        note: this.config.noteSnapshot(),
        ytext: this.config.ytext,
        ydoc: this.config.ydoc,
        outputEl: state.outputEl,
        isActive,
        registerDisposer: (fn) => {
          if (!isActive()) {
            try {
              fn();
            } catch (err) {
              console.error("[kit dispose late]", err);
            }
            return;
          }
          state.disposers.push(fn);
        },
      });
      void runScript(this.source, kit, state.outputEl, { isActive, errorEl: state.errorEl });
    } catch (err) {
      console.error("[scripts] widget-side setup failed:", err);
      if (isActive()) {
        const block = document.createElement("div");
        block.className =
          "md-script-error-block flex flex-col gap-1 px-3 py-2 rounded text-xs " +
          "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 " +
          "border border-red-200 dark:border-red-900";
        block.textContent = `script widget error: ${err instanceof Error ? err.message : String(err)}`;
        state.errorEl.appendChild(block);
      }
    }
  }
}

// =============================================================================
// Fence parser
// =============================================================================

/**
 * Extract the language tag and body of a `FencedCode` node by walking
 * its Lezer-markdown children. Same lexer the markdown preview
 * pipeline uses, so accepts every variant `marked` accepts (3+
 * backticks / tildes, indented fences, missing closing fence).
 *
 * `node` MUST be the `FencedCode` node itself — not a cursor /
 * resolved position. Pulling the SyntaxNode straight from `iterate`'s
 * `nodeRef.node` avoids the trap where `tree.cursorAt(from, 1)`
 * lands on the opening `CodeMark` (no children) and silently skips
 * every block (codex review on commit 972e16e).
 *
 * Returns null when the fence isn't a `script` block.
 */
type FenceParts = { body: string };
type ScriptRange = { from: number; to: number; collapseTo: number };
type ScriptDecorationState = {
  decorations: DecorationSet;
  collapsedSourceDecorations: DecorationSet;
  scriptRanges: ScriptRange[];
};

const parseScriptFence = (state: EditorState, node: SyntaxNode): FenceParts | null => {
  let info: string | null = null;
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
  const body = bodyFrom !== null && bodyTo !== null ? state.doc.sliceString(bodyFrom, bodyTo) : "";
  return { body };
};

// =============================================================================
// Output widget decoration
// =============================================================================

class HiddenScriptSourceWidget extends WidgetType {
  override toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "cm-script-source-collapsed";
    el.setAttribute("aria-hidden", "true");
    return el;
  }

  override eq(other: WidgetType): boolean {
    return other instanceof HiddenScriptSourceWidget;
  }

  override ignoreEvent(): boolean {
    return true;
  }

  override get estimatedHeight(): number {
    return 0;
  }
}

/**
 * Walk the doc and emit ONE additive block widget per `\`\`\`script`
 * fence, anchored just past the FencedCode end. When the cursor is
 * away from the fence, also collapse the source with a zero-height
 * replacement. The output widget is never folded into that replace
 * widget because it owns script runtime lifecycle state.
 *
 * `updateDOM()` keeps the output DOM alive across source and position
 * changes, so typing outside the script or moving it in the document
 * does not tear down the running kit output.
 */
const changeMightAffectScriptFence = (tr: Transaction): boolean => {
  let might = false;
  tr.changes.iterChanges((_fromA, _toA, fromB, toB, inserted) => {
    if (might) return;
    const insertedText = inserted.toString();
    if (insertedText.includes("`") || insertedText.includes("~") || insertedText.includes("script")) {
      might = true;
      return;
    }

    const from = Math.max(0, fromB - 16);
    const to = Math.min(tr.state.doc.length, toB + 16);
    const context = tr.state.doc.sliceString(from, to);
    might = context.includes("```") || context.includes("~~~");
  });
  return might;
};

const changesIntersectScriptRanges = (tr: Transaction, ranges: ScriptRange[]): boolean => {
  if (ranges.length === 0) return false;
  let intersects = false;
  tr.changes.iterChangedRanges((fromA, toA) => {
    if (intersects) return;
    intersects = ranges.some((range) => fromA <= range.to && toA >= range.from);
  });
  return intersects;
};

const cursorScriptKey = (state: EditorState, ranges: ScriptRange[]): number | null => {
  if (ranges.length === 0) return null;
  const cursor = state.selection.main;
  for (const r of ranges) {
    const prevLineStart = state.doc.lineAt(Math.max(r.from - 1, 0)).from;
    const nextLineEnd = state.doc.lineAt(Math.min(r.to + 1, state.doc.length)).to;
    if (cursor.from >= prevLineStart && cursor.to <= nextLineEnd) return r.from;
  }
  return null;
};

const isCollapsedScriptRange = (
  collapsedSourceDecorations: DecorationSet,
  range: ScriptRange,
): boolean => {
  let collapsed = false;
  collapsedSourceDecorations.between(range.from, range.collapseTo, (from, to) => {
    if (from === range.from && to === range.collapseTo) {
      collapsed = true;
      return false;
    }
    return undefined;
  });
  return collapsed;
};

const scanScripts = (state: EditorState, config: ScriptsConfig): ScriptDecorationState => {
  if (!config.scriptsEnabled()) {
    return {
      decorations: Decoration.none,
      collapsedSourceDecorations: Decoration.none,
      scriptRanges: [],
    };
  }

  const widgets: Range<Decoration>[] = [];
  const collapsedSourceWidgets: Range<Decoration>[] = [];
  const scriptRanges: ScriptRange[] = [];
  const cursor = state.selection.main;
  let scriptIndex = 0;
  syntaxTree(state).iterate({
    enter: (nodeRef) => {
      if (nodeRef.type.name !== "FencedCode") return;
      const parts = parseScriptFence(state, nodeRef.node);
      if (!parts) return;

      const closingLine = state.doc.lineAt(Math.max(0, nodeRef.to - 1));
      const firstLine = state.doc.lineAt(nodeRef.from);
      const sourceFrom = firstLine.from;
      const sourceTo = closingLine.to;
      const outputPos = nodeRef.to > sourceTo ? nodeRef.to : sourceTo;
      // Keep the output widget OUTSIDE the replaced range. Most fenced-code
      // nodes include the trailing newline, so `nodeRef.to` is safely after
      // the closing-fence line. If the script is at EOF and there is no
      // trailing newline, leave the closing fence visible as a fallback rather
      // than replacing the position that owns the output widget.
      const collapseTo = sourceTo;
      const range = { from: sourceFrom, to: nodeRef.to, collapseTo };
      scriptRanges.push(range);
      const lineCount = closingLine.number - firstLine.number + 1;

      const prevLine = state.doc.lineAt(Math.max(sourceFrom - 1, 0));
      const nextLine = state.doc.lineAt(Math.min(nodeRef.to + 1, state.doc.length));
      const sourceVisible = cursor.from >= prevLine.from && cursor.to <= nextLine.to;
      if (!sourceVisible && collapseTo > sourceFrom) {
        const collapsedSource = Decoration.replace({
          widget: new HiddenScriptSourceWidget(),
          block: true,
          inclusiveEnd: false,
        }).range(sourceFrom, collapseTo);
        widgets.push(collapsedSource);
        collapsedSourceWidgets.push(collapsedSource);
      }

      // INLINE widget (block: false). This is the critical
      // difference from earlier revisions:
      //
      //   `Decoration.widget({ block: true, side: 1 })` becomes a
      //   `WidgetAfter` block decoration (CM internals,
      //   PointDecoration.fromMark in @codemirror/view). CM6's
      //   `posAtCoords(scanY)` loop in `moveVertically` then treats
      //   the widget as a non-Text block and SKIPS it during
      //   vertical scan, repositioning yOffset to `widget.top -
      //   halfLine`. With only one script in the doc, that lands
      //   on the closing fence line — observed by users as
      //   "ArrowUp from anywhere jumps to the bottom of the first
      //   script block". Tables don't trigger this because their
      //   decoration is a `Decoration.replace` (BlockType
      //   `WidgetRange`, with content length) AND because they
      //   drop the widget when the cursor is on the table or its
      //   next line.
      //
      // An inline widget is NOT a block in CM's layout — its
      // BlockType stays Text (the line that contains it). Vertical
      // navigation around it works the same as around any
      // character; the widget doesn't act as an attractor for the
      // upward scan.
      //
      // We anchor at the END of the closing-fence line so the
      // widget sits visually below the script when CSS gives it
      // `display: block`. `lineAt(nodeRef.to - 1).to` resolves to
      // the closing fence's line end regardless of whether
      // FencedCode includes the trailing `\n` in its range.
      widgets.push(
        Decoration.widget({
          widget: new OutputWidget(parts.body, config, sourceFrom, lineCount, scriptIndex),
          side: 1,
          // block: false (default) — INLINE widget, see comment above.
        }).range(outputPos),
      );
      scriptIndex++;
    },
  });
  return {
    decorations: widgets.length > 0 ? RangeSet.of(widgets, true) : Decoration.none,
    collapsedSourceDecorations:
      collapsedSourceWidgets.length > 0 ? RangeSet.of(collapsedSourceWidgets, true) : Decoration.none,
    scriptRanges,
  };
};

// =============================================================================
// Extension factory
// =============================================================================

/**
 * `ArrowDown` interceptor for the closing-fence + output-widget
 * cursor-stuck cases.
 *
 * Two related bugs land here, both rooted in the same cause: the
 * output widget is INLINE (`block: false`) styled `display: block`
 * via CSS, so it's logically attached to the closing-fence line in
 * CM's model but visually occupies a second row beneath that line.
 * CM treats those two visual rows as ONE logical line:
 *
 *   1. Caret AT END of closing fence (`\`\`\`|`) → `moveVertically`
 *      calls `posAtCoords({y: cursorY + halfText}, scanY=+1)`,
 *      yOffset lands in the widget area, maps back to
 *      `closingLine.to` (same position) → caret loops in place.
 *   2. Caret ANYWHERE ELSE on the closing-fence line (e.g.
 *      `|\`\`\``) → ArrowDown moves "down one visual row" within
 *      the same logical line, lands inside the widget area, maps
 *      back to `closingLine.to` → caret jumps to end of fence
 *      instead of past the widget.
 *
 * Either way the caret never makes it to the next REAL line below
 * the script. ArrowUp doesn't have this problem because the upward
 * scan crosses into a different line block.
 *
 * Pragmatic fix: when the caret is on a `\`\`\`script` block's
 * closing-fence line and the user presses ArrowDown, dispatch the
 * caret to the start of the next line ourselves. Targeted on
 * purpose — default ArrowDown elsewhere stays untouched, including
 * regular ```js / ```py fences where there's no widget.
 *
 * Selection-extending variants (Shift-ArrowDown / Mod-ArrowDown)
 * aren't intercepted yet — mirror the same logic onto them if a
 * report comes in.
 */
const arrowDownPastWidgetKeymap = (config: ScriptsConfig) =>
  // `Prec.highest` so we run BEFORE the default ArrowDown command
  // (`cursorLineDown` from `@codemirror/commands`). Without this,
  // the default fires first, consumes the event, and our handler
  // never runs.
  Prec.highest(
    keymap.of([
      {
        key: "ArrowDown",
        run: (view) => {
          if (!config.scriptsEnabled()) return false;
          const sel = view.state.selection.main;
          if (!sel.empty) return false;
          const cursor = sel.head;

          const cursorLine = view.state.doc.lineAt(cursor);

          // Walk every FencedCode in the doc and check whether the
          // caret sits on a `\`\`\`script` block's closing-fence
          // line. We iterate (rather than `tree.resolveInner`)
          // because at line boundaries the resolver can land on
          // an adjacent node — CodeText of the previous line, or
          // the closing CodeMark, depending on `side` — and walking
          // up from the wrong child sometimes misses the parent.
          // Iterating is O(scripts-in-doc) which is fine; a typical
          // note has at most a handful.
          let scriptFenced: SyntaxNode | null = null;
          syntaxTree(view.state).iterate({
            enter: (nodeRef) => {
              if (nodeRef.type.name !== "FencedCode") return;
              if (cursor < nodeRef.from || cursor > nodeRef.to) return false;
              const parts = parseScriptFence(view.state, nodeRef.node);
              if (!parts) return false;
              const closingLine = view.state.doc.lineAt(Math.max(0, nodeRef.to - 1));
              if (closingLine.from === cursorLine.from) {
                scriptFenced = nodeRef.node;
                return false;
              }
              return false;
            },
          });
          if (!scriptFenced) return false;

          // Caret is on a script's closing-fence line. Default
          // ArrowDown lands inside the inline-but-display:block
          // output widget which CM maps back to `closingLine.to`
          // (same logical line). Skip past the widget by
          // dispatching to the start of the next REAL line.
          const fenced = scriptFenced as SyntaxNode;
          const closingLine = view.state.doc.lineAt(Math.max(0, fenced.to - 1));
          const totalLines = view.state.doc.lines;
          const nextPos =
            closingLine.number < totalLines
              ? view.state.doc.line(closingLine.number + 1).from
              : view.state.doc.length;

          view.dispatch({
            selection: { anchor: nextPos },
            scrollIntoView: true,
            userEvent: "select",
          });
          return true;
        },
      },
    ]),
  );

/**
 * Public extension factory. Wire it alongside the other rich-mode
 * extensions in `NoteEditor.client.tsx`.
 *
 * Returns:
 *  1. The script StateField — emits one additive INLINE output
 *     widget per `\`\`\`script` fence and one zero-height source
 *     collapse `Decoration.replace({ block: true })` when the cursor
 *     is outside the script zone. The runtime output stays in the
 *     inline widget shape that avoids the `WidgetAfter` cursor-jump
 *     bug we hit with earlier revisions.
 *  2. The output-frame theme.
 *  3. The ArrowDown interceptor — fixes the caret-stuck-at-
 *     closing-fence-end edge case that comes with inline widgets
 *     styled as blocks.
 *
 * NOTE: an earlier revision included an auto-fold `ViewPlugin` that
 * kept fold state synced with caret position. That layer caused
 * cursor displacement on ArrowUp from anywhere in the doc — every
 * `selectionSet` triggered fold/unfold dispatches and the resulting
 * layout shifts confused CM's vertical-navigation math. Auto-fold
 * is left out on purpose.
 */
export const scriptsExtension = (config: ScriptsConfig): Extension => {
  const outputField = StateField.define<ScriptDecorationState>({
    create: (state) => scanScripts(state, config),
    update: (value, tx) => {
      if (!config.scriptsEnabled()) {
        return {
          decorations: Decoration.none,
          collapsedSourceDecorations: Decoration.none,
          scriptRanges: [],
        };
      }

      if (tx.docChanged) {
        const decorations = value.decorations.map(tx.changes);
        const collapsedSourceDecorations = value.collapsedSourceDecorations.map(tx.changes);
        const mightAffectScriptFence = changeMightAffectScriptFence(tx);
        if (value.scriptRanges.length === 0 && !mightAffectScriptFence) {
          return { decorations, collapsedSourceDecorations, scriptRanges: [] };
        }
        if (!changesIntersectScriptRanges(tx, value.scriptRanges) && !mightAffectScriptFence) {
          return {
            decorations,
            collapsedSourceDecorations,
            scriptRanges: value.scriptRanges.map((range) => ({
              from: tx.changes.mapPos(range.from, 1),
              to: tx.changes.mapPos(range.to, -1),
              collapseTo: tx.changes.mapPos(range.collapseTo, -1),
            })),
          };
        }
        return scanScripts(tx.state, config);
      }
      if (!tx.selection) {
        return value;
      }
      const oldKey = cursorScriptKey(tx.startState, value.scriptRanges);
      const newKey = cursorScriptKey(tx.state, value.scriptRanges);
      if (oldKey === newKey) return value;
      return scanScripts(tx.state, config);
    },
    provide: (f) => [
      EditorView.decorations.from(f, (value) => value.decorations),
      EditorView.atomicRanges.of((view) => view.state.field(f).collapsedSourceDecorations),
    ],
  });

  const collapsedSourceEditKeymap = Prec.highest(
    keymap.of([
      {
        key: "Backspace",
        run: (view) => openCollapsedSourceInsteadOfDeleting(view, -1),
      },
      {
        key: "Delete",
        run: (view) => openCollapsedSourceInsteadOfDeleting(view, 1),
      },
    ]),
  );

  function openCollapsedSourceInsteadOfDeleting(view: EditorView, dir: -1 | 1): boolean {
    const scriptState = view.state.field(outputField, false);
    if (!scriptState) return false;
    const selection = view.state.selection.main;

    const target = scriptState.scriptRanges.find((range) => {
      if (!isCollapsedScriptRange(scriptState.collapsedSourceDecorations, range)) return false;
      if (!selection.empty) return selection.from < range.collapseTo && selection.to > range.from;
      return dir < 0 ? selection.head === range.collapseTo : selection.head === range.from;
    });
    if (!target) return false;

    view.dispatch({
      selection: { anchor: dir < 0 ? target.collapseTo : target.from },
      scrollIntoView: true,
      userEvent: "select",
    });
    return true;
  }

  const outputFrameTheme = EditorView.theme({
    ".cm-script-source-collapsed": {
      display: "block",
      height: "0 !important",
      minHeight: "0 !important",
      margin: "0 !important",
      padding: "0 !important",
      overflow: "hidden",
    },
    ".cm-script-output-frame": {
      boxSizing: "border-box",
      border: "1px solid rgb(59 130 246 / 0.32)",
      borderRadius: "6px",
      backgroundColor: "rgb(59 130 246 / 0.035)",
      padding: "0.5rem",
    },
    ".cm-script-output-header": {
      display: "flex",
      alignItems: "center",
      gap: "0.45rem",
      minHeight: "1.25rem",
      color: "#1d4ed8",
      cursor: "pointer",
      fontSize: "0.75rem",
      lineHeight: "1rem",
      userSelect: "none",
    },
    ".cm-script-output-header:hover": {
      color: "#1e40af",
    },
    ".cm-script-output-title": {
      fontWeight: "600",
    },
    ".cm-script-output-meta": {
      marginLeft: "auto",
      opacity: "0.72",
    },
    ".cm-script-output-frame .md-script-output": {
      border: "0",
      borderRadius: "0",
      background: "transparent",
      padding: "0.5rem 0 0",
    },
    ".cm-script-output-frame .md-script-errors": {
      marginTop: "0.5rem",
    },
    ".dark .cm-script-output-frame": {
      borderColor: "rgb(96 165 250 / 0.36)",
      backgroundColor: "rgb(30 64 175 / 0.14)",
    },
    ".dark .cm-script-output-header": {
      color: "#bfdbfe",
    },
    ".dark .cm-script-output-header:hover": {
      color: "#dbeafe",
    },
  });

  return [outputField, outputFrameTheme, collapsedSourceEditKeymap, arrowDownPastWidgetKeymap(config)];
};
