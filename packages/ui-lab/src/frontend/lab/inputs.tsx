/**
 * Inputs tab — form primitives. Each demo is its own Function-Component
 * so its signals are isolated.
 */

import {
  AutocompleteEditor,
  Checkbox,
  CheckboxCard,
  ColorInput,
  Combobox,
  DatePicker,
  DateRangePicker,
  DateTimeInput,
  DateTimePicker,
  IconInput,
  ImageInput,
  MarkdownEditor,
  MultiSelectInput,
  NumberInput,
  PinInput,
  Select,
  SelectChip,
  Slider,
  Switch,
  TagsInput,
  TextInput,
} from "@valentinkolb/cloud/ui";
import { type DateContext, dates } from "@valentinkolb/stdlib";
import { createSignal, Show } from "solid-js";
import DemoCard from "./DemoCard";

const FROM_UI = "@valentinkolb/cloud/ui";
const pickerDateConfig: DateContext = { timeZone: "Europe/Berlin", weekStartsOn: 1 };
const pickerToday = dates.formatDateKey(new Date(), pickerDateConfig);
const pickerTomorrow = dates.formatDateKey(dates.addDays(new Date(), 1, pickerDateConfig), pickerDateConfig);
const pickerNextWeek = dates.formatDateKey(dates.addWeeks(new Date(), 1, pickerDateConfig), pickerDateConfig);
const pickerDateTime = (date: string, time: string) =>
  typeof dates.zonedDateTimeToInstant === "function"
    ? dates.zonedDateTimeToInstant(`${date}T${time}`, pickerDateConfig.timeZone!, { disambiguation: "compatible" })
    : `${date}T${time}`;

/* ── TextInput ───────────────────────────────────────────────── */

export const TextInputBasic = () => {
  const [v, setV] = createSignal("Sample value");
  return (
    <DemoCard
      id="textinput-basic"
      chip={{ kind: "component", name: "TextInput", from: FROM_UI }}
      description="Standard single-line input. `value` is an accessor function, not a direct value."
      code={`<TextInput label="Name" placeholder="Enter name…" value={v} onInput={setV} />`}
    >
      <TextInput label="Name" placeholder="Enter name…" value={v} onInput={setV} />
    </DemoCard>
  );
};

export const TextInputWithIcon = () => {
  const [v, setV] = createSignal("");
  return (
    <DemoCard
      id="textinput-icon"
      chip={{ kind: "component", name: "TextInput", from: FROM_UI }}
      variant="with icon"
      code={`<TextInput icon="ti ti-search" placeholder="Search…" value={v} onInput={setV} />`}
    >
      <TextInput icon="ti ti-search" placeholder="Search…" value={v} onInput={setV} />
    </DemoCard>
  );
};

export const TextInputClearable = () => {
  const [v, setV] = createSignal("Click the X");
  return (
    <DemoCard
      id="textinput-clearable"
      chip={{ kind: "component", name: "TextInput", from: FROM_UI }}
      variant="clearable"
      code={`<TextInput clearable value={v} onInput={setV} />`}
    >
      <TextInput clearable value={v} onInput={setV} />
    </DemoCard>
  );
};

export const TextInputError = () => {
  const [v, setV] = createSignal("ab");
  return (
    <DemoCard
      id="textinput-error"
      chip={{ kind: "component", name: "TextInput", from: FROM_UI }}
      variant="error state"
      description="Error message renders via `InputWrapper`; red border on the field. The error prop is itself an accessor."
      code={`<TextInput
  label="Username"
  value={v}
  onInput={setV}
  error={() => (v().length < 3 ? "At least 3 characters" : undefined)}
/>`}
    >
      <TextInput label="Username" value={v} onInput={setV} error={() => (v().length < 3 ? "At least 3 characters" : undefined)} />
    </DemoCard>
  );
};

export const TextInputPassword = () => {
  const [v, setV] = createSignal("secret");
  return (
    <DemoCard
      id="textinput-password"
      chip={{ kind: "component", name: "TextInput", from: FROM_UI }}
      variant="password"
      code={`<TextInput password label="Password" value={v} onInput={setV} />`}
    >
      <TextInput password label="Password" value={v} onInput={setV} />
    </DemoCard>
  );
};

export const TextInputMarkdown = () => {
  const [v, setV] = createSignal(
    [
      "## Welcome",
      "",
      "Type **bold** with `Cmd/Ctrl+B`, *italic* with `Cmd/Ctrl+I`.",
      "",
      "- Smart list continuation: press Enter for another item",
      "- AutoText: type `mfg`, `lg`, or `bsnk` followed by a space",
      "- Tab-complete: type a prefix like `mf` and press Tab",
      "",
      "Recognised words like mfg and lg light up with a blue dotted underline.",
      "",
      "Paste a URL on selected text to make a link.",
    ].join("\n"),
  );
  return (
    <DemoCard
      id="textinput-markdown"
      chip={{ kind: "component", name: "TextInput", from: FROM_UI }}
      variant="markdown mode + abbreviations"
      description="Live syntax-highlighted overlay editor with ghost completion at the caret (zinc-400 + → arrow). Tab accepts the ghost; a word-boundary char auto-expands matching abbreviations. Known labels get a blue dotted underline everywhere they appear."
      code={`<TextInput
  markdown
  label="Description"
  lines={8}
  value={v}
  onInput={setV}
  abbreviations={{
    mfg: "Mit freundlichen Grüßen",
    lg: "Liebe Grüße",
    bsnk: "beschädigt aber nicht kaputt",
  }}
/>`}
    >
      <TextInput
        markdown
        label="Description"
        lines={8}
        value={v}
        onInput={setV}
        abbreviations={{
          mfg: "Mit freundlichen Grüßen",
          lg: "Liebe Grüße",
          bsnk: "beschädigt aber nicht kaputt",
        }}
      />
    </DemoCard>
  );
};

/**
 * Triggered-completion demo: `@` opens a user-mention completion.
 * `suggest` is a plain sync function over a static array — same shape
 * as a real implementation would have if it hit an in-memory cache;
 * the only difference for an async backend is returning a Promise.
 *
 * The list is intentionally small so the ghost preview behaviour is
 * obvious. Type `@a` and the preview shows `@alice` in dim text + a
 * `→` arrow; Tab accepts.
 */
export const TextInputMarkdownCompletions = () => {
  const USERS = ["alice", "bob", "charlie", "dani", "eli", "frank", "grace"];
  const TAGS = ["backend", "frontend", "infra", "bug", "feature", "docs", "urgent"];
  const [v, setV] = createSignal(
    [
      "## Team note",
      "",
      "Type `@` for users or `#` for tags. Use ↑/↓ to navigate, Tab/Enter to accept.",
      "",
      "@alice please look at the #bug in the #frontend.",
      "",
      "All known mentions get a blue tint in the rendered preview.",
    ].join("\n"),
  );
  return (
    <DemoCard
      id="textinput-markdown-completions"
      chip={{ kind: "component", name: "TextInput", from: FROM_UI }}
      variant="markdown mode + multiple triggers + dropdown"
      description="Two triggered completions side-by-side: `@` for users and `#` for tags. With `dropdown: true` a caret-anchored dropdown lists all matches — ↑/↓ navigate, Tab/Enter insert, click picks, Esc closes. The dropdown uses the Popover API (top-layer, modal-safe) without stealing focus from the editor, so typing keeps working while it's open."
      code={`<TextInput
  markdown
  label="Note"
  lines={8}
  value={v}
  onInput={setV}
  completions={[
    {
      trigger: "@",
      dropdown: true,
      suggest: (q) => USERS
        .filter(u => u.startsWith(q.toLowerCase()))
        .map(u => ({ text: "@" + u, hint: "user" })),
    },
    {
      trigger: "#",
      dropdown: true,
      suggest: (q) => TAGS
        .filter(t => t.startsWith(q.toLowerCase()))
        .map(t => ({ text: "#" + t, hint: "tag" })),
    },
  ]}
/>`}
    >
      <TextInput
        markdown
        label="Note"
        lines={8}
        value={v}
        onInput={setV}
        completions={[
          {
            trigger: "@",
            dropdown: true,
            suggest: (query) =>
              USERS.filter((u) => u.startsWith(query.toLowerCase())).map((u) => ({
                text: "@" + u,
                hint: "user",
              })),
          },
          {
            trigger: "#",
            dropdown: true,
            suggest: (query) =>
              TAGS.filter((t) => t.startsWith(query.toLowerCase())).map((t) => ({
                text: "#" + t,
                hint: "tag",
              })),
          },
        ]}
      />
    </DemoCard>
  );
};

export const MarkdownEditorStandalone = () => {
  const [v, setV] = createSignal(
    "Standalone editor without the InputWrapper chrome.\n\nUse for email composers, full-page notes, doc bodies.",
  );
  return (
    <DemoCard
      id="markdowneditor-standalone"
      chip={{ kind: "component", name: "MarkdownEditor", from: FROM_UI }}
      description="Same editor that powers `<TextInput markdown />`, exposed for non-form use-cases. Same prop shape — only the chrome is gone."
      code={`<MarkdownEditor value={v} onInput={setV} lines={6} placeholder="Write…" />`}
    >
      <MarkdownEditor value={v} onInput={setV} lines={6} placeholder="Write…" />
    </DemoCard>
  );
};

/* ── AutocompleteEditor ─────────────────────────────────────── */

/**
 * Generic plain-text autocompletion. Same engine as MarkdownEditor but
 * no markdown rendering. The four demos cover:
 *   - sync mentions (`@user`)
 *   - excel-style formula with context-aware nested completions
 *   - async fetch with loading + retry
 *   - single-line mode (Enter submits)
 */

export const AutocompleteEditorMentions = () => {
  const USERS = ["alice", "bob", "charlie", "dani", "eli", "frank", "grace"];
  const [v, setV] = createSignal("Hey @alice and @bob, please check this — cc @c");
  return (
    <DemoCard
      id="autocomplete-mentions"
      chip={{ kind: "component", name: "AutocompleteEditor", from: FROM_UI }}
      variant="sync triggered completion"
      description="Plain-text editor with a `@user` trigger. Dropdown opens at the caret, Tab/Enter insert, no markdown rendering involved."
      code={`<AutocompleteEditor
  value={v} onInput={setV} lines={3}
  completions={[{
    trigger: "@",
    dropdown: true,
    suggest: (query) => USERS
      .filter(u => u.startsWith(query.toLowerCase()))
      .map(u => ({ text: "@" + u, hint: "user" })),
  }]}
/>`}
    >
      <AutocompleteEditor
        value={v}
        onInput={setV}
        lines={3}
        completions={[
          {
            trigger: "@",
            dropdown: true,
            suggest: (query) =>
              USERS.filter((u) => u.startsWith(query.toLowerCase())).map((u) => ({
                text: "@" + u,
                hint: "user",
              })),
          },
        ]}
      />
    </DemoCard>
  );
};

export const AutocompleteEditorFormula = () => {
  // Closure-captured "schema" — would be a reactive signal in a real
  // database app. Mock data here to demonstrate context-aware completions.
  const COLUMNS = [
    { name: "revenue", type: "number" },
    { name: "cost", type: "number" },
    { name: "profit", type: "number" },
    { name: "quantity", type: "number" },
    { name: "name", type: "string" },
    { name: "active", type: "boolean" },
    { name: "created_at", type: "date" },
  ];
  const NUMERIC_FUNCS = ["SUM", "AVG", "COUNT", "MIN", "MAX"];
  const ALL_FUNCS = [...NUMERIC_FUNCS, "IF", "CONCAT"];

  // Shared "what fits at a value position?" logic. Used by every
  // operator trigger (`(`, `,`, `*`, `+`, `-`, `/`) — they all expect
  // either a column reference or a nested function call after them.
  // Inspects the text BEFORE the trigger to figure out:
  //   - whether we're inside a numeric-only function (SUM/AVG/MIN/MAX)
  //     OR after an arithmetic operator → numeric columns only
  //   - otherwise (inside CONCAT, IF, or top-level) → any column type
  // The trigger char is included in each suggestion's `text` so the
  // engine's match/insert logic works; `displayLabel` strips it from
  // the dropdown row visually.
  const valuesAt = (
    triggerChar: string,
    query: string,
    ctx: { fullText: string; tokenStart: number },
  ): { text: string; hint?: string }[] => {
    const before = ctx.fullText.slice(0, ctx.tokenStart);

    // Numeric context detection: inside a numeric function, or right
    // after an arithmetic operator outside any function.
    const inNumericFn = /(SUM|AVG|MIN|MAX)\([^()]*$/.test(before);
    const inAnyFn = /(SUM|AVG|MIN|MAX|COUNT|CONCAT|IF)\([^()]*$/.test(before);
    const afterArithmetic = /[+\-*/]\s*$/.test(before);
    const numericOnly = inNumericFn || (!inAnyFn && afterArithmetic);

    const q = query.toLowerCase();
    const cols = COLUMNS.filter((c) => !numericOnly || c.type === "number")
      .filter((c) => c.name.toLowerCase().startsWith(q))
      .map((c) => ({ text: triggerChar + c.name, hint: c.type }));

    // Also offer nested function calls — letting the user build
    // `=SUM(revenue) * SUM(cost)` style expressions.
    const fns = (numericOnly ? NUMERIC_FUNCS : ALL_FUNCS)
      .filter((f) => f.toLowerCase().startsWith(q))
      .map((f) => ({ text: triggerChar + f + "(", hint: "function" }));

    return [...cols, ...fns];
  };

  // Syntax highlighter — tokenise into typed segments in ONE pass,
  // then emit Tailwind-coloured spans. The single-pass tokeniser
  // avoids the pitfall of replacing inside already-emitted span tags
  // (e.g. column regex matching `class` inside `class="..."` would
  // corrupt the HTML). All styling is colour-only — no font-weight
  // / font-style / letter-spacing changes — so glyph widths match
  // the textarea exactly (overtype constraint).
  const COL_NAMES = COLUMNS.map((c) => c.name);
  const FORMULA_RE = new RegExp(
    `(?<!\\w)(${ALL_FUNCS.join("|")})(?!\\w)` + `|(?<!\\w)(${COL_NAMES.join("|")})(?!\\w)` + `|(\\d+(?:\\.\\d+)?)` + `|([+\\-*/,()=])`,
    "g",
  );
  const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const classFor: Record<string, string> = {
    fn: "text-blue-600 dark:text-blue-400",
    col: "text-emerald-600 dark:text-emerald-400",
    num: "text-amber-600 dark:text-amber-400",
    op: "text-zinc-400 dark:text-zinc-500",
  };
  const formulaHighlight = (text: string): string => {
    let out = "";
    let lastIndex = 0;
    FORMULA_RE.lastIndex = 0;
    while (true) {
      const m = FORMULA_RE.exec(text);
      if (m === null) break;
      if (m.index > lastIndex) out += escapeHtml(text.slice(lastIndex, m.index));
      const type = m[1] ? "fn" : m[2] ? "col" : m[3] ? "num" : "op";
      out += `<span class="${classFor[type]}">${escapeHtml(m[0])}</span>`;
      lastIndex = m.index + m[0].length;
    }
    if (lastIndex < text.length) out += escapeHtml(text.slice(lastIndex));
    return out;
  };

  const [v, setV] = createSignal("");

  return (
    <DemoCard
      id="autocomplete-formula"
      chip={{ kind: "component", name: "AutocompleteEditor", from: FROM_UI }}
      variant="context-aware nested completions + syntax highlighting"
      description="Excel-style formula editor with chained completions AND a custom `highlight` callback that colours functions / columns / numbers / operators in the live preview. Multi-line mode (`lines={4}`) so you can compose longer formulas across lines. Type `=` for functions, then `(`, `,`, or any arithmetic operator (`+`, `-`, `*`, `/`) to see column refs or nested function calls — filtered by context (`SUM(…)` accepts numbers only, `CONCAT(…)` any type, top-level arithmetic also numeric-only)."
      code={`<AutocompleteEditor
  value={v} onInput={setV} lines={4}
  highlight={formulaHighlight}
  completions={[
    {
      trigger: "=",
      dropdown: true,
      suggest: (query) => ALL_FUNCS
        .filter(f => f.startsWith(query.toUpperCase()))
        .map(f => ({ text: "=" + f + "(", hint: "function" })),
    },
    // One completion per "value-position" trigger — each forwards
    // to the shared valuesAt() helper which inspects the surrounding
    // text to decide between numeric vs any-type completions and
    // mixes in nested function suggestions.
    ...["(", ",", "+", "-", "*", "/"].map(ch => ({
      trigger: ch,
      dropdown: true,
      allowAfterWord: true,
      suggest: (query, ctx) => valuesAt(ch, query, ctx),
    })),
    // Space trigger: fires when cursor is right after a space that's
    // itself right after an operator. Lets \`=SUM(revenue * \` still
    // suggest values even with whitespace between operator and word.
    {
      trigger: " ",
      dropdown: true,
      allowAfterWord: true,
      suggest: (q, ctx) => {
        const before = ctx.fullText.slice(0, ctx.tokenStart);
        if (!/[+\\-*/,(]$/.test(before)) return [];
        return valuesAt(" ", q, ctx);
      },
    },
  ]}
/>`}
    >
      <AutocompleteEditor
        value={v}
        onInput={setV}
        lines={4}
        highlight={formulaHighlight}
        placeholder="Type `=` to start a formula… e.g. `=SUM(revenue) * AVG(cost)`"
        completions={[
          {
            trigger: "=",
            dropdown: true,
            suggest: (query) =>
              ALL_FUNCS.filter((f) => f.startsWith(query.toUpperCase())).map((f) => ({
                text: "=" + f + "(",
                hint: "function",
              })),
          },
          ...["(", ",", "+", "-", "*", "/"].map((ch) => ({
            trigger: ch,
            dropdown: true,
            allowAfterWord: true,
            suggest: (query: string, ctx: { fullText: string; tokenStart: number }) => valuesAt(ch, query, ctx),
          })),
          // Whitespace tolerance: when the user types a space after an
          // operator (e.g. `=SUM(revenue * `), the cursor is no longer
          // directly after the operator — `detectQuery` would normally
          // see ` ` as the trigger char and bail out. Register space as
          // its OWN trigger that delegates back to valuesAt, gated on
          // "is the preceding char a value-position opener?". The space
          // gets included in the inserted text so it's preserved.
          {
            trigger: " ",
            dropdown: true,
            allowAfterWord: true,
            suggest: (query: string, ctx: { fullText: string; tokenStart: number }) => {
              const before = ctx.fullText.slice(0, ctx.tokenStart);
              if (!/[+\-*/,(]$/.test(before)) return [];
              return valuesAt(" ", query, ctx);
            },
          },
        ]}
      />
    </DemoCard>
  );
};

export const AutocompleteEditorAsync = () => {
  // Mock async lookup: pretends to hit an API, sometimes errors out
  // randomly so the Retry button is exercisable.
  const MOCK_PACKAGES = [
    "react",
    "react-dom",
    "solid-js",
    "vue",
    "svelte",
    "lodash",
    "ramda",
    "rxjs",
    "redux",
    "zustand",
    "express",
    "fastify",
    "koa",
    "hono",
  ];

  const fakeFetch = (query: string, signal: AbortSignal): Promise<{ text: string; hint?: string }[]> =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        if (Math.random() < 0.15) {
          reject(new Error("Network blip — try again"));
          return;
        }
        const hits = MOCK_PACKAGES.filter((p) => p.startsWith(query.toLowerCase())).map((p) => ({
          text: p,
          hint: "npm",
        }));
        resolve(hits);
      }, 400);
      signal.addEventListener("abort", () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      });
    });

  const [v, setV] = createSignal("");

  return (
    <DemoCard
      id="autocomplete-async"
      chip={{ kind: "component", name: "AutocompleteEditor", from: FROM_UI }}
      variant="async suggest with debounce + abort + retry"
      description="Suggest returns a Promise. Editor debounces ~180ms after last keystroke, aborts in-flight requests on every new char, shows a Loading spinner, surfaces errors with a Retry button (this mock errors ~15% of the time)."
      code={`const suggestPackages = (query, _ctx, signal) =>
  lookupPackages(query, signal);

<AutocompleteEditor
  value={v} onInput={setV} singleLine
  completions={[{ dropdown: true, suggest: suggestPackages }]}
/>`}
    >
      <AutocompleteEditor
        value={v}
        onInput={setV}
        singleLine
        placeholder="Type a package name (try `re`, `ho`, `sv`)…"
        completions={[
          {
            dropdown: true,
            suggest: (query, _ctx, signal) => fakeFetch(query, signal),
          },
        ]}
      />
    </DemoCard>
  );
};

export const AutocompleteEditorSingleLine = () => {
  const [v, setV] = createSignal("");
  const [submitted, setSubmitted] = createSignal<string | null>(null);
  return (
    <DemoCard
      id="autocomplete-singleline"
      chip={{ kind: "component", name: "AutocompleteEditor", from: FROM_UI }}
      variant="single-line + submit on Enter"
      description="`singleLine` prop: Enter calls `onSubmit`, no newlines. Useful for command-palette / search-builder inputs."
      code={`<AutocompleteEditor
  value={v} onInput={setV} singleLine
  placeholder="Type something and press Enter"
  onSubmit={() => alert(v())}
/>`}
    >
      <div class="flex flex-col gap-2">
        <AutocompleteEditor
          value={v}
          onInput={setV}
          singleLine
          placeholder="Type something and press Enter"
          onSubmit={() => setSubmitted(v())}
        />
        <Show when={submitted()}>
          <div class="text-xs text-zinc-500 dark:text-zinc-400">
            submitted: <span class="font-mono">{submitted()}</span>
          </div>
        </Show>
      </div>
    </DemoCard>
  );
};

/* ── NumberInput ────────────────────────────────────────────── */

export const NumberInputBasic = () => {
  const [v, setV] = createSignal<number | null>(42);
  return (
    <DemoCard
      id="numberinput-basic"
      chip={{ kind: "component", name: "NumberInput", from: FROM_UI }}
      variant="integer"
      description="`decimalPlaces` defaults to 0 — dot / comma are filtered. Steppers visible by default."
      code={`<NumberInput label="Count" value={v} onChange={setV} min={0} max={100} step={1} />`}
    >
      <NumberInput label="Count" value={v} onChange={setV} min={0} max={100} step={1} />
    </DemoCard>
  );
};

export const NumberInputPercent = () => {
  const [v, setV] = createSignal<number | null>(25);
  return (
    <DemoCard
      id="numberinput-percent"
      chip={{ kind: "component", name: "NumberInput", from: FROM_UI }}
      variant="percent with suffix"
      code={`<NumberInput
  label="Discount"
  value={v}
  onChange={setV}
  min={0} max={100} step={0.5}
  decimalPlaces={1}
  suffix={<span class="font-mono">%</span>}
/>`}
    >
      <NumberInput
        label="Discount"
        value={v}
        onChange={setV}
        min={0}
        max={100}
        step={0.5}
        decimalPlaces={1}
        suffix={<span class="font-mono">%</span>}
      />
    </DemoCard>
  );
};

export const NumberInputCurrency = () => {
  const [v, setV] = createSignal<number | null>(12.34);
  return (
    <DemoCard
      id="numberinput-currency"
      chip={{ kind: "component", name: "NumberInput", from: FROM_UI }}
      variant="currency, clearable, no steppers"
      code={`<NumberInput
  label="Price"
  placeholder="12.34 €"
  value={v}
  onChange={setV}
  decimalPlaces={2} step={0.01}
  suffix={<span class="font-mono">€</span>}
  clearable
  showSteppers={false}
/>`}
    >
      <NumberInput
        label="Price"
        placeholder="12.34 €"
        value={v}
        onChange={setV}
        decimalPlaces={2}
        step={0.01}
        suffix={<span class="font-mono">€</span>}
        clearable
        showSteppers={false}
      />
    </DemoCard>
  );
};

/* ── Date/Time ───────────────────────────────────────────────── */

export const DatePickerDemo = () => {
  const [v, setV] = createSignal<string | null>(pickerToday);
  return (
    <DemoCard
      id="datepicker-basic"
      chip={{ kind: "component", name: "DatePicker", from: FROM_UI }}
      variant="single date"
      description="Popover calendar with caller-owned presets. Values stay date-only `YYYY-MM-DD` strings."
      code={`<DatePicker
  label="Due date"
  value={date}
  onChange={setDate}
  presets={[
    { label: "Today", value: today },
    { label: "Tomorrow", value: tomorrow },
  ]}
/>`}
    >
      <DatePicker
        label="Due date"
        placeholder="Pick date"
        value={v}
        onChange={setV}
        clearable
        dateConfig={pickerDateConfig}
        presets={[
          { label: "Today", value: pickerToday },
          { label: "Tomorrow", value: pickerTomorrow },
          { label: "Next week", value: pickerNextWeek },
        ]}
      />
      <p class="mt-2 font-mono text-xs text-dimmed">{v() ?? "null"}</p>
    </DemoCard>
  );
};

export const DatePickerPlainDemo = () => {
  const [v, setV] = createSignal<string | null>(null);
  return (
    <DemoCard
      id="datepicker-plain"
      chip={{ kind: "component", name: "DatePicker", from: FROM_UI }}
      variant="plain"
      description="Minimal date picker without presets. Use this when shortcuts would add noise."
      code={`<DatePicker
  label="Birthday"
  placeholder="Pick date"
  value={date}
  onChange={setDate}
  clearable
/>`}
    >
      <DatePicker label="Birthday" placeholder="Pick date" value={v} onChange={setV} clearable dateConfig={pickerDateConfig} />
      <p class="mt-2 font-mono text-xs text-dimmed">{v() ?? "null"}</p>
    </DemoCard>
  );
};

export const DateTimePickerDemo = () => {
  const [v, setV] = createSignal<string | null>(pickerDateTime(pickerToday, "09:00"));
  return (
    <DemoCard
      id="datetimepicker-basic"
      chip={{ kind: "component", name: "DateTimePicker", from: FROM_UI }}
      variant="timezone-aware"
      description="The timezone is passive info. With `dateConfig`, picked wall-clock time is emitted as a UTC instant."
      code={`<DateTimePicker
  label="Start"
  value={startsAt}
  onChange={setStartsAt}
  dateConfig={dateConfig}
  presets={[
    { label: "Tomorrow 09:00", value: tomorrowNineUtc },
  ]}
/>`}
    >
      <DateTimePicker
        label="Start"
        placeholder="Pick date and time"
        value={v}
        onChange={setV}
        clearable
        dateConfig={pickerDateConfig}
        presets={[
          { label: "Today 09:00", value: pickerDateTime(pickerToday, "09:00") },
          { label: "Today 14:00", value: pickerDateTime(pickerToday, "14:00") },
          { label: "Tomorrow 09:00", value: pickerDateTime(pickerTomorrow, "09:00") },
        ]}
      />
      <p class="mt-2 font-mono text-xs text-dimmed">{v() ?? "null"}</p>
    </DemoCard>
  );
};

export const DateRangePickerDemo = () => {
  const [v, setV] = createSignal({ start: pickerToday, end: pickerTomorrow });
  return (
    <DemoCard
      id="daterangepicker-basic"
      chip={{ kind: "component", name: "DateRangePicker", from: FROM_UI }}
      variant="date range"
      description="Range selection uses the same panel. Presets are plain caller data; no hardcoded preset sets live in Cloud UI."
      code={`<DateRangePicker
  label="Range"
  value={range}
  onChange={setRange}
  presets={[
    { label: "Today", value: { start: today, end: today } },
    { label: "Next 7 days", value: { start: today, end: nextWeek } },
  ]}
/>`}
    >
      <DateRangePicker
        label="Range"
        value={v}
        onChange={setV}
        clearable
        dateConfig={pickerDateConfig}
        presets={[
          { label: "Today", value: { start: pickerToday, end: pickerToday } },
          { label: "Tomorrow", value: { start: pickerTomorrow, end: pickerTomorrow } },
          { label: "Next 7 days", value: { start: pickerToday, end: pickerNextWeek } },
        ]}
      />
      <p class="mt-2 font-mono text-xs text-dimmed">{JSON.stringify(v())}</p>
    </DemoCard>
  );
};

export const DateRangePickerWithTimeDemo = () => {
  const [v, setV] = createSignal({
    start: pickerDateTime(pickerToday, "09:00"),
    end: pickerDateTime(pickerToday, "10:00"),
  });
  return (
    <DemoCard
      id="daterangepicker-time"
      chip={{ kind: "component", name: "DateRangePicker", from: FROM_UI }}
      variant="range + time"
      description="Timed ranges can use date presets that keep the picker open plus duration shortcuts that only update the end time."
      code={`<DateRangePicker
  withTime
  label="Schedule"
  value={schedule}
  onChange={setSchedule}
  dateConfig={dateConfig}
  datePresets={[
    { label: "Today", value: today },
    { label: "Tomorrow", value: tomorrow },
  ]}
  durationPresets={[
    { label: "30m", minutes: 30 },
    { label: "1.5h", minutes: 90 },
  ]}
/>`}
    >
      <DateRangePicker
        withTime
        label="Schedule"
        value={v}
        onChange={setV}
        clearable
        dateConfig={pickerDateConfig}
        datePresets={[
          { label: "Today", value: pickerToday },
          { label: "Tomorrow", value: pickerTomorrow },
          { label: "Next week", value: pickerNextWeek },
        ]}
        durationPresets={[
          { label: "30m", minutes: 30 },
          { label: "1h", minutes: 60 },
          { label: "1.5h", minutes: 90 },
          { label: "2h", minutes: 120 },
          { label: "3h", minutes: 180 },
        ]}
      />
      <p class="mt-2 font-mono text-xs text-dimmed">{JSON.stringify(v())}</p>
    </DemoCard>
  );
};

export const DateTimeInputDemo = () => {
  const [v, setV] = createSignal("2026-02-18T10:30");
  return (
    <DemoCard
      id="datetimeinput-basic"
      chip={{ kind: "component", name: "DateTimeInput", from: FROM_UI }}
      variant="date + time"
      code={`<DateTimeInput label="Starts at" value={v} onChange={setV} />`}
    >
      <DateTimeInput label="Starts at" value={v} onChange={setV} />
    </DemoCard>
  );
};

export const DateInputDemo = () => {
  const [v, setV] = createSignal("2026-02-18");
  return (
    <DemoCard
      id="datetimeinput-date-only"
      chip={{ kind: "component", name: "DateTimeInput", from: FROM_UI }}
      variant="date only"
      code={`<DateTimeInput dateOnly label="Birthday" value={v} onChange={setV} />`}
    >
      <DateTimeInput dateOnly label="Birthday" value={v} onChange={setV} />
    </DemoCard>
  );
};

/* ── Select / SelectChip / Combobox ─────────────────────────── */

export const SelectBasic = () => {
  const [v, setV] = createSignal<string | undefined>("refined");
  return (
    <DemoCard
      id="select-basic"
      chip={{ kind: "component", name: "Select", from: FROM_UI }}
      variant="static options"
      code={`<Select
  label="Theme"
  placeholder="Choose one…"
  options={[
    { id: "refined", label: "Refined", icon: "ti ti-sparkles" },
    { id: "compact", label: "Compact", icon: "ti ti-layout-grid" },
  ]}
  value={v}
  onChange={setV}
  clearable
/>`}
    >
      <Select
        label="Theme"
        placeholder="Choose one…"
        options={[
          { id: "refined", label: "Refined", icon: "ti ti-sparkles" },
          { id: "compact", label: "Compact", icon: "ti ti-layout-grid" },
        ]}
        value={v}
        onChange={(id) => setV(id ?? undefined)}
        clearable
      />
    </DemoCard>
  );
};

export const SelectFetchData = () => {
  const [v, setV] = createSignal<string | undefined>(undefined);
  const cities = ["Berlin", "Munich", "Hamburg", "Cologne", "Frankfurt", "Stuttgart", "Düsseldorf", "Leipzig"];
  return (
    <DemoCard
      id="select-fetchdata"
      chip={{ kind: "component", name: "Select", from: FROM_UI }}
      variant="searchable with fetchData"
      description="`fetchData` is called on every input change. Supports async / API-backed option lists."
      code={`<Select
  label="City"
  placeholder="Search a city…"
  value={v}
  onChange={setV}
  fetchData={async (q) =>
    cities
      .filter((c) => c.toLowerCase().includes(q.toLowerCase()))
      .map((c) => ({ id: c, label: c }))
  }
  clearable
/>`}
    >
      <Select
        label="City"
        placeholder="Search a city…"
        value={v}
        onChange={(id) => setV(id ?? undefined)}
        fetchData={async (q) => cities.filter((c) => c.toLowerCase().includes(q.toLowerCase())).map((c) => ({ id: c, label: c }))}
        clearable
      />
    </DemoCard>
  );
};

export const SelectChipDemo = () => {
  const [v, setV] = createSignal<"day" | "week" | "month">("week");
  return (
    <DemoCard
      id="selectchip"
      chip={{ kind: "component", name: "SelectChip", from: FROM_UI }}
      description="Compact inline dropdown — use in toolbars where `<Select>` would be too large. Options use `{ value, label }`."
      code={`<SelectChip<"day" | "week" | "month">
  value={v()}
  icon="ti ti-calendar"
  options={[
    { value: "day", label: "Day" },
    { value: "week", label: "Week" },
    { value: "month", label: "Month" },
  ]}
  onChange={setV}
/>`}
    >
      <SelectChip<"day" | "week" | "month">
        value={v()}
        icon="ti ti-calendar"
        options={[
          { value: "day", label: "Day" },
          { value: "week", label: "Week" },
          { value: "month", label: "Month" },
        ]}
        onChange={setV}
      />
    </DemoCard>
  );
};

export const MultiSelectInputDemo = () => {
  const options = [
    {
      id: "open",
      label: "Open",
      description: "Ready to be picked up.",
      icon: "ti ti-circle",
      color: "#3b82f6",
    },
    {
      id: "review",
      label: "In review",
      description: "Needs a second pair of eyes.",
      icon: "ti ti-eye",
      color: "#8b5cf6",
    },
    {
      id: "blocked",
      label: "Blocked",
      description: "Waiting on another team.",
      icon: "ti ti-alert-triangle",
      color: "#f59e0b",
    },
    {
      id: "done",
      label: "Done",
      description: "Closed and shipped.",
      icon: "ti ti-check",
      color: "#10b981",
    },
    {
      id: "waiting",
      label: "Waiting",
      description: "Paused until a date or reply.",
      icon: "ti ti-clock",
      color: "#64748b",
    },
    {
      id: "urgent",
      label: "Urgent",
      description: "Needs attention today.",
      icon: "ti ti-bolt",
      color: "#ef4444",
    },
    {
      id: "planned",
      label: "Planned",
      description: "Scheduled but not started.",
      icon: "ti ti-calendar",
      color: "#06b6d4",
    },
  ];
  const [v, setV] = createSignal(options.map((option) => option.id));
  return (
    <DemoCard
      id="multiselectinput"
      chip={{ kind: "component", name: "MultiSelectInput", from: FROM_UI }}
      variant="colored option pills"
      description="Multi-value select with searchable options, descriptions, icons, and soft colored pills in the input."
      code={`<MultiSelectInput
  label="Statuses"
  placeholder="Choose statuses..."
  value={v}
  onChange={setV}
  clearable
  options={options}
/>`}
    >
      <MultiSelectInput label="Statuses" placeholder="Choose statuses..." value={v} onChange={setV} clearable options={options} />
    </DemoCard>
  );
};

export const ComboboxDemo = () => {
  const [picked, setPicked] = createSignal<string | null>(null);
  const countries = [
    { id: "de", label: "Germany", icon: "ti-flag" },
    { id: "fr", label: "France", icon: "ti-flag" },
    { id: "it", label: "Italy", icon: "ti-flag" },
    { id: "es", label: "Spain", icon: "ti-flag" },
    { id: "pt", label: "Portugal", icon: "ti-flag" },
  ];
  return (
    <DemoCard
      id="combobox"
      chip={{ kind: "component", name: "Combobox", from: FROM_UI }}
      description="Fire-and-forget search. Type to filter, click to fire `onSelect` (input clears, popover closes). For stateful picks, use `Select`."
      code={`<Combobox
  placeholder="Search countries…"
  fetchData={async (q) =>
    countries.filter(c => c.label.toLowerCase().includes(q.toLowerCase()))
  }
  onSelect={(opt) => setPicked(opt.label)}
/>`}
    >
      <div class="flex flex-col gap-2">
        <Combobox
          placeholder="Search countries…"
          fetchData={async (q) => countries.filter((c) => c.label.toLowerCase().includes(q.toLowerCase()))}
          onSelect={(opt) => setPicked(opt.label)}
        />
        <p class="text-xs text-dimmed">Last picked: {picked() ?? "—"}</p>
      </div>
    </DemoCard>
  );
};

/* ── Color / Tags / Pin / Image / Icon ──────────────────────── */

export const ColorInputDemo = () => {
  const [v, setV] = createSignal("#06b6d4");
  const [isTransparent, setTransparent] = createSignal(false);
  return (
    <DemoCard
      id="colorinput"
      chip={{ kind: "component", name: "ColorInput", from: FROM_UI }}
      variant="with transparent toggle"
      description="Pair `transparent` (boolean flag → shows the toggle) with `isTransparent` (accessor for the current state)."
      code={`<ColorInput
  label="Accent"
  value={v}
  onChange={setV}
  transparent
  isTransparent={isTransparent}
  onTransparentChange={setTransparent}
/>`}
    >
      <ColorInput label="Accent" value={v} onChange={setV} transparent isTransparent={isTransparent} onTransparentChange={setTransparent} />
    </DemoCard>
  );
};

export const TagsInputDemo = () => {
  const [v, setV] = createSignal(["backend", "ui", "core"]);
  return (
    <DemoCard
      id="tagsinput"
      chip={{ kind: "component", name: "TagsInput", from: FROM_UI }}
      code={`<TagsInput label="Labels" value={v} onChange={setV} placeholder="Add tag…" />`}
    >
      <TagsInput label="Labels" value={v} onChange={setV} placeholder="Add tag…" />
    </DemoCard>
  );
};

export const PinInputDemo = () => {
  const [v, setV] = createSignal("426913");
  return (
    <DemoCard
      id="pininput"
      chip={{ kind: "component", name: "PinInput", from: FROM_UI }}
      code={`<PinInput label="One-time code" length={6} value={v} onChange={setV} />`}
    >
      <PinInput label="One-time code" length={6} value={v} onChange={setV} />
    </DemoCard>
  );
};

export const ImageInputDemo = () => {
  const [v, setV] = createSignal<string | null>(null);
  return (
    <DemoCard
      id="imageinput"
      chip={{ kind: "component", name: "ImageInput", from: FROM_UI }}
      description="Outputs a base64 data URL. Drag-drop and file-picker supported."
      code={`<ImageInput label="Avatar" value={v} onChange={setV} />`}
    >
      <ImageInput label="Avatar" value={v} onChange={setV} />
    </DemoCard>
  );
};

export const IconInputDemo = () => {
  const [v, setV] = createSignal("ti-star");
  return (
    <DemoCard
      id="iconinput"
      chip={{ kind: "component", name: "IconInput", from: FROM_UI }}
      description="Searchable Tabler icon picker. Fuzzy search across all icons with synonym matching."
      code={`<IconInput label="Icon" value={v} onChange={setV} />`}
    >
      <IconInput label="Icon" value={v} onChange={setV} />
    </DemoCard>
  );
};

/* ── Slider / Switch / Checkbox / Segmented ─────────────────── */

export const SliderDemo = () => {
  const [v, setV] = createSignal(64);
  return (
    <DemoCard
      id="slider"
      chip={{ kind: "component", name: "Slider", from: FROM_UI }}
      code={`<Slider label="Volume" value={v} onChange={setV} min={0} max={100} showValue />`}
    >
      <Slider label="Volume" value={v} onChange={setV} min={0} max={100} showValue />
    </DemoCard>
  );
};

export const SwitchDemo = () => {
  const [v, setV] = createSignal(true);
  return (
    <DemoCard
      id="switch"
      chip={{ kind: "component", name: "Switch", from: FROM_UI }}
      code={`<Switch label="Notifications" value={v} onChange={setV} />`}
    >
      <Switch label="Notifications" value={v} onChange={setV} />
    </DemoCard>
  );
};

export const CheckboxDemo = () => {
  const [v, setV] = createSignal(true);
  return (
    <DemoCard
      id="checkbox"
      chip={{ kind: "component", name: "Checkbox", from: FROM_UI }}
      code={`<Checkbox label="I agree to the terms" value={v} onChange={setV} />`}
    >
      <Checkbox label="I agree to the terms" value={v} onChange={setV} />
    </DemoCard>
  );
};

export const CheckboxCardDemo = () => {
  const [paid, setPaid] = createSignal(true);
  const [review, setReview] = createSignal(false);
  const [allDay, setAllDay] = createSignal(false);
  return (
    <DemoCard
      id="checkbox-card"
      chip={{ kind: "component", name: "CheckboxCard", from: FROM_UI }}
      description="Card-shaped checkbox for option lists that need a short explanation. The whole card is clickable."
      code={`<CheckboxCard
  label="Paid"
  description="Invoice is already settled."
  color="#22c55e"
  value={paid}
  onChange={setPaid}
/>`}
    >
      <div class="grid grid-cols-1 gap-2">
        <CheckboxCard label="Paid" description="Invoice is already settled." color="#22c55e" value={paid} onChange={setPaid} />
        <CheckboxCard
          label="All-day event"
          description="Uses input field background for dense forms."
          icon="ti ti-calendar"
          variant="input"
          value={allDay}
          onChange={setAllDay}
        />
        <CheckboxCard
          label="Needs review"
          description="Office team should check the record before it moves on."
          color="#f59e0b"
          value={review}
          onChange={setReview}
        />
      </div>
    </DemoCard>
  );
};

/* ── Tab assembly ─────────────────────────────────────────── */

export const InputsTab = () => (
  <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
    <TextInputBasic />
    <TextInputWithIcon />
    <TextInputClearable />
    <TextInputError />
    <TextInputPassword />
    <TextInputMarkdown />
    <TextInputMarkdownCompletions />
    <MarkdownEditorStandalone />
    <AutocompleteEditorMentions />
    <AutocompleteEditorFormula />
    <AutocompleteEditorAsync />
    <AutocompleteEditorSingleLine />
    <NumberInputBasic />
    <NumberInputPercent />
    <NumberInputCurrency />
    <DateTimeInputDemo />
    <DateInputDemo />
    <SelectBasic />
    <SelectFetchData />
    <SelectChipDemo />
    <MultiSelectInputDemo />
    <ComboboxDemo />
    <ColorInputDemo />
    <TagsInputDemo />
    <PinInputDemo />
    <ImageInputDemo />
    <IconInputDemo />
    <SliderDemo />
    <SwitchDemo />
    <CheckboxDemo />
    <CheckboxCardDemo />
  </div>
);
