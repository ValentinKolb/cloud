/**
 * Script runner — evaluates a ```script block's source as an
 * `AsyncFunction(kit, console)` body and renders its output / errors
 * into a caller-supplied container.
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
 *
 * Console interception: a per-run `console`-like object is injected
 * as the second AsyncFunction parameter. Because that parameter
 * SHADOWS the global `console` inside the script's body, the user's
 * `console.log(...)` calls land in our object — no global mutation,
 * no concurrency issues across multiple scripts running in parallel.
 * The injected console mirrors to the real `console` so devtools
 * still see the messages.
 */
import type { Kit } from "./kit";

export type RunResult = { ok: true } | { ok: false; error: Error };
export type RunScriptOptions = {
  /** False when an edit-mode widget has already re-run or unmounted.
   *  Console writes / output appends respect this flag — late
   *  callbacks from stale runs don't pollute the active output. */
  isActive?: () => boolean;
  /** Optional separate container for error blocks. When provided,
   *  parse / runtime errors render here instead of in `outputEl` —
   *  giving the UI a visually distinct "error" box outside the
   *  kit/console output card. Falls back to `outputEl` for callers
   *  (e.g. read-mode) that don't need the split. */
  errorEl?: HTMLElement;
};

/** Lazily-resolved AsyncFunction constructor. The literal
 *  `Object.getPrototypeOf(async () => {}).constructor` is the
 *  cross-realm-safe way to get it without a top-level `eval`. */
const AsyncFunctionCtor = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

/**
 * Evaluate `source` as the body of `async (kit, console) => { ... }`
 * and await its completion. Errors (parse + runtime, sync + async)
 * are caught and rendered as a red error block inside `outputEl`.
 *
 * The caller is expected to clear `outputEl` BEFORE invoking this if
 * they want a fresh paint. We don't clear here because the caller may
 * want to preserve state across runs (e.g. a header / loading
 * indicator) — that's their decision, not ours.
 *
 * Returns a `RunResult` mostly for tests / future wiring; production
 * callers can ignore it.
 */
export const runScript = async (
  source: string,
  kit: Kit,
  outputEl: HTMLElement,
  options?: RunScriptOptions,
): Promise<RunResult> => {
  const isActive = options?.isActive ?? (() => true);
  const errorEl = options?.errorEl ?? outputEl;
  // Strip stale error class from the previous run.
  outputEl.classList.remove("md-script-error");
  errorEl.classList.remove("md-script-error");

  const scriptConsole = createScriptConsole(outputEl, isActive);

  let fn: (...args: unknown[]) => Promise<unknown>;
  try {
    fn = new AsyncFunctionCtor("kit", "console", source);
  } catch (parseError) {
    // SyntaxError — surface with line/column when the engine provides it.
    if (isActive()) renderError(errorEl, parseError, "parse error");
    return { ok: false, error: asError(parseError) };
  }

  try {
    await fn(kit, scriptConsole);
    return { ok: true };
  } catch (runError) {
    if (isActive()) renderError(errorEl, runError, "runtime error");
    return { ok: false, error: asError(runError) };
  }
};

// =============================================================================
// Per-run console
// =============================================================================

/** Stringify a single console argument the way `console.log` does
 *  for objects (pretty-JSON). Primitives become their `String()`
 *  form. JSON failures (cycles, BigInt without prototype hook) fall
 *  back to a plain string cast. */
const formatArg = (arg: unknown): string => {
  if (typeof arg === "string") return arg;
  if (arg === null || arg === undefined) return String(arg);
  if (typeof arg === "object") {
    try {
      return JSON.stringify(arg, null, 2);
    } catch {
      return String(arg);
    }
  }
  return String(arg);
};

const formatArgs = (args: unknown[]): string => args.map(formatArg).join(" ");

type LogVariant = "log" | "error" | "warn" | "info" | "debug";

/**
 * Build a `console`-like object that appends to `outputEl` and
 * mirrors to the real `console`. The returned object is a Proxy:
 *  - methods we explicitly override (`log`, `error`, `warn`, `info`,
 *    `debug`, `table`, `html`, `clear`, `time`, `timeEnd`, `dir`,
 *    `group`, `groupEnd`, `groupCollapsed`) write to the output box.
 *  - any other property access (`count`, `assert`, `trace`, etc.)
 *    falls through to the real console so scripts that use those
 *    don't break — they just won't show in the output box.
 *
 * The `isActive` guard is checked on every call so late callbacks
 * from a stale (unmounted/re-run) script don't write into the
 * active output container of a different run.
 */
const createScriptConsole = (outputEl: HTMLElement, isActive: () => boolean): Console => {
  const realConsole = globalThis.console;
  const timers = new Map<string, number>();
  const counters = new Map<string, number>();
  let groupDepth = 0;

  /** Append a styled element to the output. Applies group-depth
   *  indentation and respects `isActive` so stale-run callbacks
   *  don't pollute the active output container. Returns null when
   *  the run is no longer active. */
  const appendNode = <T extends HTMLElement>(node: T): T | null => {
    if (!isActive()) return null;
    if (groupDepth > 0) node.style.marginLeft = `${groupDepth}rem`;
    outputEl.appendChild(node);
    return node;
  };

  const appendLog = (variant: LogVariant, args: unknown[]): void => {
    const line = document.createElement("div");
    line.className = `md-script-log md-script-log-${variant}`;
    line.textContent = formatArgs(args);
    appendNode(line);
  };

  const overrides: Partial<Console> & { html: (html: string) => void } = {
    log: (...args: unknown[]) => {
      appendLog("log", args);
      realConsole.log(...args);
    },
    error: (...args: unknown[]) => {
      appendLog("error", args);
      realConsole.error(...args);
    },
    warn: (...args: unknown[]) => {
      appendLog("warn", args);
      realConsole.warn(...args);
    },
    info: (...args: unknown[]) => {
      appendLog("info", args);
      realConsole.info(...args);
    },
    debug: (...args: unknown[]) => {
      appendLog("debug", args);
      realConsole.debug(...args);
    },
    dir: (obj: unknown) => {
      appendLog("debug", [formatArg(obj)]);
      realConsole.dir(obj);
    },
    table: (data: unknown) => {
      if (isActive()) appendNode(renderTable(data));
      realConsole.table(data);
    },
    /** NOT a standard `console` method — `console.html(rawHtml)` is
     *  our extension. Trusted scripts (per-notebook opt-in) can use
     *  it to render arbitrary HTML in the output. */
    html: (html: string) => {
      const div = document.createElement("div");
      div.className = "md-script-html";
      div.innerHTML = html;
      appendNode(div);
    },
    clear: () => {
      if (!isActive()) return;
      outputEl.replaceChildren();
      // Don't mirror clear() to real console — it'd wipe the
      // user's whole devtools log which is jarring.
    },
    time: (label?: string) => {
      timers.set(label ?? "default", performance.now());
    },
    timeEnd: (label?: string) => {
      const key = label ?? "default";
      const start = timers.get(key);
      if (start === undefined) return;
      timers.delete(key);
      const dur = performance.now() - start;
      const human = dur >= 1000 ? `${(dur / 1000).toFixed(2)}s` : `${dur.toFixed(2)}ms`;
      appendLog("info", [`${key}: ${human}`]);
    },
    count: (label?: string) => {
      const key = label ?? "default";
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      appendLog("info", [`${key}: ${next}`]);
    },
    countReset: (label?: string) => {
      counters.delete(label ?? "default");
    },
    group: (...args: unknown[]) => {
      appendLog("info", args);
      groupDepth++;
      realConsole.group(...args);
    },
    groupCollapsed: (...args: unknown[]) => {
      appendLog("info", args);
      groupDepth++;
      realConsole.groupCollapsed(...args);
    },
    groupEnd: () => {
      groupDepth = Math.max(0, groupDepth - 1);
      realConsole.groupEnd();
    },
  };

  // Proxy: prefer overrides, otherwise pass through to real console
  // (with `this` bound to the real console for native methods that
  // use it internally).
  return new Proxy(overrides as object, {
    get(target, prop, receiver) {
      if (prop in target) {
        return Reflect.get(target, prop, receiver);
      }
      const value = (realConsole as unknown as Record<PropertyKey, unknown>)[prop];
      if (typeof value === "function") return (value as (...args: unknown[]) => unknown).bind(realConsole);
      return value;
    },
  }) as unknown as Console;
};

/** Render arbitrary data as a table — same conventions as
 *  `console.table` in browser devtools:
 *   - Array of objects → header is union of object keys, rows are
 *     `(index)` + values per key.
 *   - Array of primitives → 2 columns: `(index)` + `value`.
 *   - Object → 2 columns: `(key)` + `value`.
 *   - Anything else → falls back to a single-line stringified render.
 */
const renderTable = (data: unknown): HTMLElement => {
  if (Array.isArray(data)) {
    if (data.length === 0) {
      const empty = document.createElement("div");
      empty.className = "md-script-log md-script-log-info";
      empty.textContent = "[]";
      return empty;
    }
    const first = data[0];
    if (first !== null && typeof first === "object" && !Array.isArray(first)) {
      // Union of keys across all rows so heterogeneous arrays render
      // every column.
      const keys = new Set<string>();
      for (const row of data) {
        if (row !== null && typeof row === "object") {
          for (const k of Object.keys(row as Record<string, unknown>)) keys.add(k);
        }
      }
      return buildTable(["(index)", ...keys], data, (row, key, i) => {
        if (key === "(index)") return String(i);
        const obj = row as Record<string, unknown>;
        return key in obj ? formatArg(obj[key]) : "";
      });
    }
    return buildTable(["(index)", "value"], data, (row, key, i) =>
      key === "(index)" ? String(i) : formatArg(row),
    );
  }
  if (data !== null && typeof data === "object") {
    const entries = Object.entries(data as Record<string, unknown>);
    return buildTable(["(key)", "value"], entries, ([k, v], col) =>
      col === "(key)" ? String(k) : formatArg(v),
    );
  }
  // Primitives fall through to a single-line "info" log.
  const line = document.createElement("div");
  line.className = "md-script-log md-script-log-info";
  line.textContent = formatArg(data);
  return line;
};

const buildTable = <Row>(
  columns: Iterable<string>,
  rows: readonly Row[],
  cell: (row: Row, column: string, index: number) => string,
): HTMLElement => {
  const wrap = document.createElement("div");
  wrap.className = "md-script-table-wrap";

  const table = document.createElement("table");
  table.className = "md-script-table";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  const cols = Array.from(columns);
  for (const c of cols) {
    const th = document.createElement("th");
    th.textContent = c;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (let i = 0; i < rows.length; i++) {
    const tr = document.createElement("tr");
    for (const c of cols) {
      const td = document.createElement("td");
      td.textContent = cell(rows[i]!, c, i);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  wrap.appendChild(table);
  return wrap;
};

// =============================================================================
// Error rendering
// =============================================================================

/** Coerce anything thrown into an `Error` so callers always have a stack. */
const asError = (value: unknown): Error => (value instanceof Error ? value : new Error(String(value)));

/** Append a red error block to the output slot. Format mirrors the
 *  `md-formula-error` styling in `utilities-table-tile.css` for
 *  visual consistency with the formula engine in markdown tables. */
const renderError = (outputEl: HTMLElement, value: unknown, kind: "parse error" | "runtime error") => {
  const err = asError(value);
  outputEl.classList.add("md-script-error");

  const wrap = document.createElement("div");
  // No border / background / rounded / padding — the wrapping
  // `.md-script-errors` container already provides the red card.
  // Just typography + text color here so we don't render a box-in-
  // box.
  wrap.className =
    "md-script-error-block flex flex-col gap-1 text-xs " +
    "text-red-700 dark:text-red-300";

  const heading = document.createElement("div");
  heading.className = "flex items-center gap-1 font-medium";
  const icon = document.createElement("i");
  icon.className = "ti ti-alert-circle text-sm";
  const label = document.createElement("span");
  label.textContent = `script ${kind}`;
  heading.appendChild(icon);
  heading.appendChild(label);
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
