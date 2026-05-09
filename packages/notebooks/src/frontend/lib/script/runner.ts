/**
 * Script runner — evaluates a ```script block's source as an
 * `AsyncFunction(kit, source)` and renders its output / errors into
 * a caller-supplied container.
 *
 * Why AsyncFunction (not Web Worker / iframe / QuickJS):
 *  - Scripts run with the same privileges as the rest of the editor
 *    UI; we explicitly trust opt-in notebooks.
 *  - User wants UI side-effects (buttons, toasts, modals) — workers
 *    require message-passing for every UI op which is significant
 *    overhead and complexity.
 *  - Per-notebook opt-in (`scriptsEnabled`) is the security boundary,
 *    not the runtime sandbox.
 *
 * If we ever want to offer scripts in shared notebooks (where the
 * author is NOT the viewer), this will need a real sandbox. For
 * Phase 1 the trust model is "you authored / you opted in."
 */
import type { Kit } from "./kit";

export type RunResult = { ok: true } | { ok: false; error: Error };

/** Lazily-resolved AsyncFunction constructor. The literal
 *  `Object.getPrototypeOf(async () => {}).constructor` is the
 *  cross-realm-safe way to get it without a top-level `eval`. */
const AsyncFunctionCtor = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

/**
 * Evaluate `source` as the body of `async (kit) => { ... }` and
 * await its completion. Errors (parse + runtime, sync + async) are
 * caught and rendered as a red error block inside `outputEl`.
 *
 * The caller is expected to clear `outputEl` BEFORE invoking this if
 * they want a fresh paint. We don't clear here because the caller may
 * want to preserve state across runs (e.g. a header / loading
 * indicator) — that's their decision, not ours.
 *
 * Returns a `RunResult` mostly for tests / future wiring; production
 * callers can ignore it.
 */
export const runScript = async (source: string, kit: Kit, outputEl: HTMLElement): Promise<RunResult> => {
  // Strip stale error class from the previous run.
  outputEl.classList.remove("md-script-error");

  let fn: (...args: unknown[]) => Promise<unknown>;
  try {
    fn = new AsyncFunctionCtor("kit", source);
  } catch (parseError) {
    // SyntaxError — surface with line/column when the engine provides it.
    renderError(outputEl, parseError, "parse error");
    return { ok: false, error: asError(parseError) };
  }

  try {
    await fn(kit);
    return { ok: true };
  } catch (runError) {
    renderError(outputEl, runError, "runtime error");
    return { ok: false, error: asError(runError) };
  }
};

/** Coerce anything thrown into an `Error` so callers always have a stack. */
const asError = (value: unknown): Error => (value instanceof Error ? value : new Error(String(value)));

/** Append a red error block to the output slot. Format mirrors the
 *  `md-formula-error` styling in `utilities-table-tile.css` for
 *  visual consistency with the formula engine in markdown tables. */
const renderError = (outputEl: HTMLElement, value: unknown, kind: "parse error" | "runtime error") => {
  const err = asError(value);
  outputEl.classList.add("md-script-error");

  const wrap = document.createElement("div");
  wrap.className =
    "md-script-error-block flex flex-col gap-1 px-3 py-2 rounded text-xs " +
    "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 " +
    "border border-red-200 dark:border-red-900";

  const heading = document.createElement("div");
  heading.className = "flex items-center gap-1 font-medium";
  heading.innerHTML = `<i class="ti ti-alert-circle text-sm"></i><span>script ${kind}</span>`;
  wrap.appendChild(heading);

  const message = document.createElement("pre");
  message.className = "whitespace-pre-wrap break-words font-mono text-[11px] leading-snug m-0";
  message.textContent = err.message;
  wrap.appendChild(message);

  // Stack trace (collapsed) — useful for `at <anonymous>:LINE:COL`
  // breadcrumbs when the user wants line numbers in their script.
  if (err.stack && err.stack !== err.message) {
    const details = document.createElement("details");
    details.className = "mt-1";
    const summary = document.createElement("summary");
    summary.className = "cursor-pointer text-[10px] opacity-70 hover:opacity-100";
    summary.textContent = "stack";
    const stack = document.createElement("pre");
    stack.className = "whitespace-pre-wrap break-words font-mono text-[10px] leading-snug m-0 mt-1 opacity-70";
    stack.textContent = err.stack;
    details.appendChild(summary);
    details.appendChild(stack);
    wrap.appendChild(details);
  }

  outputEl.appendChild(wrap);
};
