/**
 * Standard-JavaScript-Autocomplete für Script-Fences.
 *
 * Triggers inside the same `script` / `js` / `ts` / `tsx` / `jsx`
 * fences as `kitCompletionSource`. Offers two flavours of completion:
 *
 *  1. **Keywords + globals** — flat identifier completions for `if`,
 *     `for`, `const`, `console`, `Math`, `JSON`, etc. These behave
 *     like normal identifier matches: type 2+ chars, CM filters by
 *     the typed prefix.
 *
 *  2. **Member-access snippets** — `console.log`, `JSON.stringify`,
 *     `Math.floor`, etc. These only fire when the user has typed the
 *     namespace + `.` (mirrors the kit-path behaviour). Without the
 *     gating, typing "log" in a regular expression would surface
 *     `console.log` which is noisy.
 *
 *  3. **Control-flow snippets** — `if (…){…}`, `for (let i = 0;…)`,
 *     `function name(…)`, etc. Use CM's `snippetCompletion` so the
 *     accepted insertion includes tab-stops the user can step through.
 *
 * Scope is enforced via `isInsideScriptLikeFence` — JS completion
 * MUST NOT leak into regular markdown prose. The same WeakMap cache
 * the kit source uses is shared (declared in `kit-autocomplete.ts`)
 * so we don't pay the syntax-tree walk twice per keystroke.
 */
import { type Completion, type CompletionContext, type CompletionResult, snippetCompletion } from "@codemirror/autocomplete";
import { isInsideScriptLikeFence } from "./kit-autocomplete";

// =============================================================================
// Identifier completions — keywords + globals
// =============================================================================

/** Inline-detail for an identifier. Renders dimmed next to the label
 *  via the shared `cm-kit-detail` renderer in `slash-commands/index.ts`. */
const id = (label: string, type: Completion["type"], detail: string): Completion => ({
  label,
  type,
  detail,
});

/** Keywords. `type: "keyword"` so the icon renderer in
 *  `slash-commands/index.ts` falls back to a sensible icon for them
 *  (we add a `ti-key` default for keyword type below).
 *
 *  Booleans / literals (true/false/null/undefined) are categorised as
 *  `constant` so they read differently from control-flow keywords. */
const KEYWORDS: Completion[] = [
  // Declarations
  id("const", "keyword", "block-scoped constant"),
  id("let", "keyword", "block-scoped variable"),
  id("var", "keyword", "function-scoped variable"),
  id("function", "keyword", "function declaration"),
  id("class", "keyword", "class declaration"),
  id("extends", "keyword", "class inheritance"),
  id("static", "keyword", "static class member"),
  // Control flow
  id("if", "keyword", "conditional"),
  id("else", "keyword", "else branch"),
  id("for", "keyword", "loop"),
  id("while", "keyword", "loop"),
  id("do", "keyword", "do-while loop"),
  id("switch", "keyword", "multi-branch"),
  id("case", "keyword", "switch case"),
  id("default", "keyword", "switch default"),
  id("break", "keyword", "exit loop / switch"),
  id("continue", "keyword", "next iteration"),
  id("return", "keyword", "return value"),
  // Async + errors
  id("async", "keyword", "async function"),
  id("await", "keyword", "await promise"),
  id("try", "keyword", "try / catch"),
  id("catch", "keyword", "error handler"),
  id("finally", "keyword", "finally clause"),
  id("throw", "keyword", "throw error"),
  // Operators / keywords
  id("typeof", "keyword", "type-of operator"),
  id("instanceof", "keyword", "instance check"),
  id("in", "keyword", "in-operator / for-in"),
  id("of", "keyword", "for-of"),
  id("new", "keyword", "constructor call"),
  id("this", "keyword", "current instance"),
  id("delete", "keyword", "delete property"),
  id("void", "keyword", "void operator"),
  // Modules — accepted in <script type=module> but harmless to surface
  id("import", "keyword", "import module"),
  id("export", "keyword", "export module member"),
  id("from", "keyword", "import source"),
  // Literals
  id("true", "constant", "boolean"),
  id("false", "constant", "boolean"),
  id("null", "constant", "null literal"),
  id("undefined", "constant", "undefined literal"),
];

/** Globals exposed by the browser runtime that script authors are
 *  likely to reach for. We deliberately leave out node-only globals
 *  and DOM noise (HTMLElement, etc.) to keep the list scannable. */
const GLOBALS: Completion[] = [
  id("console", "class", "console namespace"),
  id("Math", "class", "math namespace"),
  id("JSON", "class", "JSON namespace"),
  id("Date", "class", "Date constructor"),
  id("Promise", "class", "Promise constructor"),
  id("Array", "class", "Array constructor"),
  id("Object", "class", "Object constructor"),
  id("String", "class", "String constructor"),
  id("Number", "class", "Number constructor"),
  id("Boolean", "class", "Boolean constructor"),
  id("Map", "class", "Map constructor"),
  id("Set", "class", "Set constructor"),
  id("Symbol", "class", "Symbol constructor"),
  id("RegExp", "class", "RegExp constructor"),
  id("Error", "class", "Error constructor"),
  id("setTimeout", "function", "(fn, ms) → id"),
  id("setInterval", "function", "(fn, ms) → id"),
  id("clearTimeout", "function", "(id) → void"),
  id("clearInterval", "function", "(id) → void"),
  id("queueMicrotask", "function", "(fn) → void"),
  id("fetch", "function", "(url, opts?) → Promise<Response>"),
  id("structuredClone", "function", "(value) → value"),
  id("window", "variable", "global window"),
  id("document", "variable", "global document"),
  id("globalThis", "variable", "the global object"),
];

// =============================================================================
// Member-access completions — fire after `<namespace>.`
// =============================================================================

/** Members offered for `<namespace>.<prefix>`. The list maps the
 *  namespace identifier (typed before the dot) to its completions. */
const MEMBERS: Record<string, Completion[]> = {
  console: [
    snippetCompletion("log(${1:})", { label: "log", type: "method", detail: "(...args) → void" }),
    snippetCompletion("error(${1:})", { label: "error", type: "method", detail: "(...args) → void" }),
    snippetCompletion("warn(${1:})", { label: "warn", type: "method", detail: "(...args) → void" }),
    snippetCompletion("info(${1:})", { label: "info", type: "method", detail: "(...args) → void" }),
    snippetCompletion("debug(${1:})", { label: "debug", type: "method", detail: "(...args) → void" }),
    snippetCompletion("table(${1:rows})", { label: "table", type: "method", detail: "(data, cols?) → void" }),
    snippetCompletion("dir(${1:obj})", { label: "dir", type: "method", detail: "(obj) → void" }),
    snippetCompletion("group(${1:'label'})", { label: "group", type: "method", detail: "(label) → void" }),
    snippetCompletion("groupCollapsed(${1:'label'})", { label: "groupCollapsed", type: "method", detail: "(label) → void" }),
    { label: "groupEnd", type: "method", detail: "() → void" },
    snippetCompletion("time(${1:'label'})", { label: "time", type: "method", detail: "(label) → void" }),
    snippetCompletion("timeEnd(${1:'label'})", { label: "timeEnd", type: "method", detail: "(label) → void" }),
    snippetCompletion("count(${1:'label'})", { label: "count", type: "method", detail: "(label?) → void" }),
    { label: "clear", type: "method", detail: "() → void" },
  ],
  Math: [
    { label: "PI", type: "constant", detail: "≈ 3.14159" },
    { label: "E", type: "constant", detail: "≈ 2.71828" },
    snippetCompletion("floor(${1:n})", { label: "floor", type: "method", detail: "(n) → integer" }),
    snippetCompletion("ceil(${1:n})", { label: "ceil", type: "method", detail: "(n) → integer" }),
    snippetCompletion("round(${1:n})", { label: "round", type: "method", detail: "(n) → integer" }),
    snippetCompletion("abs(${1:n})", { label: "abs", type: "method", detail: "(n) → number" }),
    snippetCompletion("min(${1:a}, ${2:b})", { label: "min", type: "method", detail: "(...n) → number" }),
    snippetCompletion("max(${1:a}, ${2:b})", { label: "max", type: "method", detail: "(...n) → number" }),
    snippetCompletion("pow(${1:base}, ${2:exp})", { label: "pow", type: "method", detail: "(base, exp) → number" }),
    snippetCompletion("sqrt(${1:n})", { label: "sqrt", type: "method", detail: "(n) → number" }),
    snippetCompletion("log(${1:n})", { label: "log", type: "method", detail: "(n) → number" }),
    snippetCompletion("sin(${1:rad})", { label: "sin", type: "method", detail: "(rad) → number" }),
    snippetCompletion("cos(${1:rad})", { label: "cos", type: "method", detail: "(rad) → number" }),
    snippetCompletion("tan(${1:rad})", { label: "tan", type: "method", detail: "(rad) → number" }),
    { label: "random", type: "method", detail: "() → [0,1)" },
    snippetCompletion("trunc(${1:n})", { label: "trunc", type: "method", detail: "(n) → integer" }),
    snippetCompletion("sign(${1:n})", { label: "sign", type: "method", detail: "(n) → -1|0|1" }),
  ],
  JSON: [
    snippetCompletion("stringify(${1:value}, null, ${2:2})", {
      label: "stringify",
      type: "method",
      detail: "(value, replacer?, indent?) → string",
    }),
    snippetCompletion("parse(${1:'json'})", { label: "parse", type: "method", detail: "(text) → value" }),
  ],
  Object: [
    snippetCompletion("keys(${1:obj})", { label: "keys", type: "method", detail: "(obj) → string[]" }),
    snippetCompletion("values(${1:obj})", { label: "values", type: "method", detail: "(obj) → any[]" }),
    snippetCompletion("entries(${1:obj})", { label: "entries", type: "method", detail: "(obj) → [k,v][]" }),
    snippetCompletion("fromEntries(${1:entries})", { label: "fromEntries", type: "method", detail: "([k,v][]) → obj" }),
    snippetCompletion("assign(${1:target}, ${2:source})", { label: "assign", type: "method", detail: "(target, ...src) → target" }),
    snippetCompletion("freeze(${1:obj})", { label: "freeze", type: "method", detail: "(obj) → obj" }),
  ],
  Array: [
    snippetCompletion("from(${1:iter})", { label: "from", type: "method", detail: "(iter, mapFn?) → array" }),
    snippetCompletion("of(${1:...items})", { label: "of", type: "method", detail: "(...items) → array" }),
    snippetCompletion("isArray(${1:value})", { label: "isArray", type: "method", detail: "(v) → boolean" }),
  ],
  Promise: [
    snippetCompletion("all(${1:promises})", { label: "all", type: "method", detail: "(iter) → Promise<T[]>" }),
    snippetCompletion("allSettled(${1:promises})", { label: "allSettled", type: "method", detail: "(iter) → Promise<{status,value}[]>" }),
    snippetCompletion("race(${1:promises})", { label: "race", type: "method", detail: "(iter) → Promise<T>" }),
    snippetCompletion("any(${1:promises})", { label: "any", type: "method", detail: "(iter) → Promise<T>" }),
    snippetCompletion("resolve(${1:value})", { label: "resolve", type: "method", detail: "(v) → Promise<v>" }),
    snippetCompletion("reject(${1:error})", { label: "reject", type: "method", detail: "(err) → Promise<never>" }),
  ],
  Date: [
    { label: "now", type: "method", detail: "() → ms since epoch" },
    snippetCompletion("parse(${1:'2025-01-01'})", { label: "parse", type: "method", detail: "(text) → ms" }),
  ],
};

// =============================================================================
// Control-flow snippets
// =============================================================================

/**
 * Snippets keyed on the leading keyword. When the user types `if<cursor>`
 * the snippet completion replaces the keyword with the full scaffold;
 * each `${n:placeholder}` becomes a tab-stop in the inserted code.
 */
const SNIPPETS: Completion[] = [
  snippetCompletion("if (${1:condition}) {\n\t${2}\n}", {
    label: "if",
    type: "keyword",
    detail: "if statement",
  }),
  snippetCompletion("if (${1:condition}) {\n\t${2}\n} else {\n\t${3}\n}", {
    label: "ifelse",
    type: "keyword",
    detail: "if / else",
  }),
  snippetCompletion("for (let ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t${3}\n}", {
    label: "for",
    type: "keyword",
    detail: "for (i=0; …)",
  }),
  snippetCompletion("for (const ${1:item} of ${2:items}) {\n\t${3}\n}", {
    label: "forof",
    type: "keyword",
    detail: "for-of loop",
  }),
  snippetCompletion("for (const ${1:key} in ${2:obj}) {\n\t${3}\n}", {
    label: "forin",
    type: "keyword",
    detail: "for-in loop",
  }),
  snippetCompletion("while (${1:condition}) {\n\t${2}\n}", {
    label: "while",
    type: "keyword",
    detail: "while loop",
  }),
  snippetCompletion("function ${1:name}(${2:args}) {\n\t${3}\n}", {
    label: "function",
    type: "keyword",
    detail: "function declaration",
  }),
  snippetCompletion("const ${1:name} = (${2:args}) => {\n\t${3}\n}", {
    label: "arrow",
    type: "keyword",
    detail: "arrow function",
  }),
  snippetCompletion("async function ${1:name}(${2:args}) {\n\t${3}\n}", {
    label: "async",
    type: "keyword",
    detail: "async function",
  }),
  snippetCompletion("try {\n\t${1}\n} catch (${2:err}) {\n\t${3}\n}", {
    label: "try",
    type: "keyword",
    detail: "try / catch",
  }),
  snippetCompletion("switch (${1:value}) {\n\tcase ${2:a}:\n\t\t${3}\n\t\tbreak;\n\tdefault:\n\t\t${4}\n}", {
    label: "switch",
    type: "keyword",
    detail: "switch / case",
  }),
];

// =============================================================================
// Sources
// =============================================================================

/** Combined identifier list — snippets first (their fuller scaffolds
 *  win over bare keywords when CM ranks by score), then keywords
 *  with snippet duplicates removed, then globals. Without the dedup
 *  CM would show two entries for `if` (snippet variant + bare
 *  keyword variant) which reads as a bug. */
const SNIPPET_LABELS = new Set(SNIPPETS.map((s) => s.label));
const IDENTIFIERS_DEDUPED: Completion[] = [...SNIPPETS, ...KEYWORDS.filter((k) => !SNIPPET_LABELS.has(k.label)), ...GLOBALS];

/**
 * Source 1 — bare identifier autocomplete.
 *
 * Fires when the cursor is on a word-character sequence that's NOT
 * immediately preceded by a dot (we don't want `foo.lo` to surface
 * `log` as a top-level keyword — that's the member-access source's
 * job).
 */
const identifierSource = (context: CompletionContext): CompletionResult | null => {
  const word = context.matchBefore(/[A-Za-z_$][\w$]*/);
  if (!word) return null;
  // Skip if preceded by a `.` — that's a member access, handled by
  // memberSource below. We check the char immediately before the
  // matched word's start.
  if (word.from > 0) {
    const prev = context.state.doc.sliceString(word.from - 1, word.from);
    if (prev === ".") return null;
    if (word.from > 1 && context.state.doc.sliceString(word.from - 2, word.from) === "?.") return null;
  }
  // Only fire when the user has actually typed something; an empty
  // explicit invocation (Ctrl-Space at whitespace) returns null too,
  // because CM will surface other sources at that point and we don't
  // want to dump the full keyword list unprompted.
  if (word.from === word.to && !context.explicit) return null;
  if (!isInsideScriptLikeFence(context)) return null;
  return {
    from: word.from,
    options: IDENTIFIERS_DEDUPED,
    validFor: /^[\w$]*$/,
  };
};

/**
 * Source 2 — member-access autocomplete for `<namespace>.<prefix>`.
 *
 * Fires only when the cursor is right after `console.`, `Math.`,
 * `JSON.`, etc. Without the gating these would pollute the
 * identifier list (every keystroke would surface `log`, `floor`,
 * `random`, …).
 */
const memberSource = (context: CompletionContext): CompletionResult | null => {
  const match = context.matchBefore(/([A-Za-z_$][\w$]*)(?:\?\.|\.)([\w$]*)/);
  if (!match) return null;
  if (!isInsideScriptLikeFence(context)) return null;
  // Re-run the regex to capture the namespace + suffix lengths.
  // matchBefore gives us {from, to, text} but not capture groups.
  const captures = /^([A-Za-z_$][\w$]*)(\?\.|\.)([\w$]*)$/.exec(match.text);
  if (!captures) return null;
  const [, namespace, access, suffix] = captures;
  const options = MEMBERS[namespace!];
  if (!options) return null;
  const accessLength = access?.length ?? 1;
  return {
    from: match.from + namespace!.length + accessLength,
    to: match.from + namespace!.length + accessLength + (suffix?.length ?? 0),
    options,
    validFor: /^[\w$]*$/,
  };
};

/**
 * Public composite source. Tries member-access first (more specific),
 * then bare identifier (broader). CM autocomplete handles `null`
 * returns gracefully — both sources are wired into the
 * `autocompletion({override: […]})` array in `slash-commands/index.ts`.
 */
export const jsCompletionSource = (context: CompletionContext): CompletionResult | null =>
  memberSource(context) ?? identifierSource(context);
