/**
 * `kit.ui` — declarative UI builder surface for `\`\`\`script` blocks.
 *
 * Two equivalent ways to mount:
 *
 *   kit.ui.render(kit.ui.button("Hi", fn));   // declarative
 *   kit.ui.button("Hi", fn).show();           // chaining sugar
 *
 * Builders are pure: they return a `KitElement` (an `HTMLElement`
 * with a `.show()` method bolted on) and do NOT auto-mount. The
 * only side-effecting calls are `kit.ui.render(...)`, `.show()`,
 * and `kit.ui.toast(...)` (which fires the platform toast UI, not
 * tied to the script's output container).
 *
 * Children passed to layout primitives can be `KitElement`,
 * `HTMLElement`, plain `string` (auto-wrapped in `kit.ui.text`),
 * or falsy (`null` / `false` / `undefined` — skipped, useful for
 * inline conditionals like `cond && kit.ui.text(...)`).
 *
 * No CSS classes are exposed to scripts on purpose. Layout is
 * composed via `row` / `col` / `card`; visual variants live behind
 * specific options (e.g. `button({ variant: "danger" })`). For
 * advanced cases scripts can drop down to `kit.ui.html(...)`.
 */
import { prompts, toast as platformToast } from "@valentinkolb/cloud/ui";
import { markdown } from "@valentinkolb/cloud/shared";
import { renderPrettyTableHtml } from "../pretty-table";
import type {
  KitButtonOptions,
  KitChild,
  KitContext,
  KitElement,
  KitFormField,
  KitFormSpec,
  KitHeadingLevel,
  KitNote,
  KitTask,
  KitPromptAPI,
  KitUI,
} from "./kit-types";

/** Tag a freshly-created `HTMLElement` as a `KitElement` by giving
 *  it a `.show()` method that mounts to the active output.
 *
 *  Also sets `contenteditable="false"` on every kit element. The
 *  widget root already carries this attribute, and contenteditable
 *  inherits down the tree — but `y-codemirror.next`'s mutation
 *  observer pathway has been observed to react to specific element
 *  types (notably `<p>`) inside the widget's subtree even when an
 *  ancestor is `contenteditable=false`. Setting the attribute
 *  explicitly on every kit element gives every mutation a
 *  deterministic `target.isContentEditable === false` answer and
 *  closes the door on the Y.Text → CM → re-render → ytext-edit
 *  feedback loop that froze scripts with `kit.ui.text(\`${kit.note
 *  .tags.length}\`).show()`. */
const brand = (el: HTMLElement, ctx: KitContext): KitElement => {
  if (!el.hasAttribute("contenteditable")) {
    el.setAttribute("contenteditable", "false");
  }
  const ke = el as KitElement;
  ke.show = () => {
    if (ctx.isActive && !ctx.isActive()) return;
    ctx.outputEl.appendChild(ke);
  };
  return ke;
};

/** Convert a `KitChild` into a `Node` we can append. Strings become
 *  text wrappers; falsy values become `null` (caller skips). */
const childToNode = (child: KitChild, ctx: KitContext): Node | null => {
  if (child === null || child === undefined || child === false) return null;
  if (typeof child === "string") return makeText(child, ctx);
  // Anything else is an HTMLElement / KitElement — append directly.
  return child;
};

const appendChildren = (parent: HTMLElement, children: KitChild[], ctx: KitContext) => {
  for (const child of children) {
    const node = childToNode(child, ctx);
    if (node) parent.appendChild(node);
  }
};

// ── Content ──────────────────────────────────────────────────────

const makeText = (content: string, ctx: KitContext): KitElement => {
  // `<div>` rather than `<p>`: contentEditable-aware DOM ops in
  // browsers / CM apply special-case handling to `<p>` elements
  // (auto-split on Enter, etc.) which has been observed to feed
  // back into the widget's mutation observer and trigger a
  // re-render loop. `<div>` is structurally equivalent for our
  // purposes and stays inert.
  const el = document.createElement("div");
  el.className = "md-script-ui-text";
  el.textContent = content;
  return brand(el, ctx);
};

const makeHeading = (content: string, ctx: KitContext, level: KitHeadingLevel = 2): KitElement => {
  // Clamp the level to the valid 1..6 range — defensive against
  // callers passing arbitrary numbers via JS (no TS at runtime).
  const clamped = Math.max(1, Math.min(6, Math.floor(level))) as KitHeadingLevel;
  const el = document.createElement(`h${clamped}`);
  el.className = `md-script-ui-heading md-script-ui-heading-${clamped}`;
  el.textContent = content;
  return brand(el, ctx);
};

const makeMd = (markdownSrc: string, ctx: KitContext): KitElement => {
  const el = document.createElement("div");
  el.className = "md-script-ui-md";
  // Trusted-script-only — per-notebook opt-in is the security
  // boundary, same as `kit.ui.html`. The same `markdown.render` the
  // server uses for read-mode parses GFM + our custom extensions
  // (info blocks, task lists, etc.).
  el.innerHTML = markdown.renderSync(markdownSrc);
  return brand(el, ctx);
};

const noteHref = (ctx: KitContext, note: KitNote | string): string => {
  const shortId = typeof note === "string" ? note : note.id;
  return `/app/notebooks/${ctx.notebookId}/notes/${shortId}`;
};

const makeNoteLink = (note: KitNote | string, label: string | undefined, ctx: KitContext): KitElement => {
  const el = document.createElement("a");
  el.className =
    "md-script-ui-note-link inline-flex items-center gap-1 text-blue-700 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200";
  el.href = noteHref(ctx, note);
  const icon = document.createElement("i");
  icon.className = "ti ti-connection text-xs";
  const text = document.createElement("span");
  text.textContent = label ?? (typeof note === "string" ? note : note.title);
  el.append(icon, text);
  return brand(el, ctx);
};

const makeNoteList = (notes: KitNote[], options: { emptyText?: string } | undefined, ctx: KitContext): KitElement => {
  if (notes.length === 0) return makeText(options?.emptyText ?? "No notes", ctx);
  const list = document.createElement("ul");
  list.className = "md-script-ui-note-list";
  for (const note of notes) {
    const item = document.createElement("li");
    item.appendChild(makeNoteLink(note, undefined, ctx));
    list.appendChild(item);
  }
  return brand(list, ctx);
};

const isKitNote = (value: unknown): value is KitNote =>
  !!value && typeof value === "object" && typeof (value as KitNote).id === "string" && typeof (value as KitNote).title === "string";

const isTaskArray = (value: unknown[]): value is KitTask[] =>
  value.length > 0 &&
  value.every(
    (item) =>
      !!item &&
      typeof item === "object" &&
      typeof (item as KitTask).done === "boolean" &&
      typeof (item as KitTask).text === "string" &&
      typeof (item as KitTask).line === "number",
  );

const normalizeTableValue = (value: unknown, column?: string): string => {
  if (value === null || value === undefined) return "";
  if (isKitNote(value)) return `[${value.title}](note://${value.id})`;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Array.isArray(value)) {
    if (isTaskArray(value)) {
      const done = value.filter((task) => task.done).length;
      return `=PROGRESS(${done}, ${value.length})`;
    }
    const tagColumn = column?.toLowerCase().includes("tag") ?? false;
    return value
      .map((item) => (tagColumn && typeof item === "string" ? (item.startsWith("#") ? item : `#${item}`) : normalizeTableValue(item)))
      .join(" ");
  }
  if (typeof value === "object") {
    const maybeTasks = value as { done?: unknown; total?: unknown };
    if (typeof maybeTasks.done === "number" && typeof maybeTasks.total === "number") {
      return `=PROGRESS(${maybeTasks.done}, ${maybeTasks.total})`;
    }
    return JSON.stringify(value);
  }
  return String(value);
};

const makeTable = (
  rows: unknown[][] | Record<string, unknown>[],
  options: { columns?: string[]; emptyText?: string } | undefined,
  ctx: KitContext,
): KitElement => {
  if (rows.length === 0) return makeText(options?.emptyText ?? "No rows", ctx);
  const columns =
    options?.columns ??
    (Array.isArray(rows[0])
      ? (rows[0] as unknown[]).map((_, index) => `Column ${index + 1}`)
      : Object.keys(rows[0] as Record<string, unknown>));
  const normalizedRows = rows.map((row) =>
    columns.map((column, index) => {
      const value = Array.isArray(row) ? row[index] : (row as Record<string, unknown>)[column];
      return normalizeTableValue(value, column);
    }),
  );
  const el = document.createElement("div");
  el.className = "md-script-ui-table";
  el.innerHTML = renderPrettyTableHtml({ headers: columns, rows: normalizedRows }, { notebookId: ctx.notebookId });
  return brand(el, ctx);
};

// ── Layout ───────────────────────────────────────────────────────

const makeRow = (children: KitChild[], ctx: KitContext): KitElement => {
  const el = document.createElement("div");
  el.className = "md-script-ui-row";
  appendChildren(el, children, ctx);
  return brand(el, ctx);
};

const makeCol = (children: KitChild[], ctx: KitContext): KitElement => {
  const el = document.createElement("div");
  el.className = "md-script-ui-col";
  appendChildren(el, children, ctx);
  return brand(el, ctx);
};

const makeCard = (children: KitChild[], ctx: KitContext): KitElement => {
  const el = document.createElement("div");
  el.className = "md-script-ui-card";
  appendChildren(el, children, ctx);
  return brand(el, ctx);
};

const makeDivider = (ctx: KitContext): KitElement => {
  const el = document.createElement("hr");
  el.className = "md-script-ui-divider";
  return brand(el, ctx);
};

// ── Interactive ──────────────────────────────────────────────────

/** Map button variants to Tailwind utility classes. Kept in one
 *  place so the visual language stays consistent across the kit. */
const BUTTON_VARIANT_CLASSES: Record<NonNullable<KitButtonOptions["variant"]>, string> = {
  primary: "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 " + "hover:bg-blue-100 dark:hover:bg-blue-900/50",
  secondary: "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 " + "hover:bg-zinc-200 dark:hover:bg-zinc-700",
  danger: "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 " + "hover:bg-red-100 dark:hover:bg-red-900/50",
};

const makeButton = (
  label: string,
  onClick: () => void | Promise<void>,
  options: KitButtonOptions | undefined,
  ctx: KitContext,
): KitElement => {
  const btn = document.createElement("button");
  btn.type = "button";
  const variant = options?.variant ?? "primary";
  btn.className =
    "md-script-ui-button md-script-button inline-flex items-center gap-1 px-2 py-1 " +
    "rounded text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 " +
    "disabled:cursor-not-allowed " +
    BUTTON_VARIANT_CLASSES[variant];

  if (options?.icon) {
    const icon = document.createElement("i");
    icon.className = options.icon;
    btn.appendChild(icon);
  }

  const labelEl = document.createElement("span");
  labelEl.textContent = label;
  btn.appendChild(labelEl);

  if (options?.disabled) btn.disabled = true;

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (btn.disabled) return;
    try {
      const result = onClick();
      if (result && typeof (result as Promise<void>).then === "function") {
        (result as Promise<void>).catch((err) => {
          console.error("[kit.ui.button] onClick threw:", err);
        });
      }
    } catch (err) {
      console.error("[kit.ui.button] onClick threw:", err);
    }
  });

  return brand(btn, ctx);
};

// ── Escape hatch ─────────────────────────────────────────────────

const makeHtml = (rawHtml: string, ctx: KitContext): KitElement => {
  const el = document.createElement("div");
  el.className = "md-script-ui-html";
  el.innerHTML = rawHtml;
  return brand(el, ctx);
};

// =============================================================================
// Factory
// =============================================================================

export const createKitUI = (ctx: KitContext): KitUI => ({
  // Layout
  row: (...children) => makeRow(children, ctx),
  col: (...children) => makeCol(children, ctx),
  card: (...children) => makeCard(children, ctx),
  divider: () => makeDivider(ctx),

  // Content
  text: (content) => makeText(content, ctx),
  heading: (content, level) => makeHeading(content, ctx, level),
  md: (mdSrc) => makeMd(mdSrc, ctx),
  noteLink: (note, label) => makeNoteLink(note, label, ctx),
  noteList: (notes, options) => makeNoteList(notes, options, ctx),
  table: (rows, options) => makeTable(rows, options, ctx),

  // Interactive
  button: (label, onClick, options) => makeButton(label, onClick, options, ctx),

  // Escape hatch
  html: (rawHtml) => makeHtml(rawHtml, ctx),

  // Mount
  render: (...elements) => {
    if (ctx.isActive && !ctx.isActive()) return;
    for (const child of elements) {
      const node = childToNode(child, ctx);
      if (node) ctx.outputEl.appendChild(node);
    }
  },

  // Side effect
  toast: (description, options) => {
    if (ctx.isActive && !ctx.isActive()) return;
    platformToast(description, options);
  },
  prompt: createPromptAPI(ctx),
});

// ── Modal prompts — pass-through to the platform `prompts.*` API
// =============================================================================

const createPromptAPI = (ctx: KitContext): KitPromptAPI => ({
  alert: async (message, options) => {
    if (ctx.isActive && !ctx.isActive()) return;
    await prompts.alert(message, { title: options?.title, icon: options?.icon });
  },
  confirm: async (message, options) => {
    if (ctx.isActive && !ctx.isActive()) return false;
    return (await prompts.confirm(message, { title: options?.title, icon: options?.icon })) ?? false;
  },
  text: async (message, defaultValue, options) => {
    if (ctx.isActive && !ctx.isActive()) return null;
    const result = await prompts.form({
      title: options?.title,
      fields: {
        message: {
          type: "info",
          content: message,
        },
        value: {
          type: "text",
          label: false,
          default: defaultValue ?? "",
          placeholder: options?.placeholder,
        },
      },
    });
    return result?.value ?? null;
  },
  form: async (spec: KitFormSpec) => {
    if (ctx.isActive && !ctx.isActive()) return null;
    // Platform `prompts.form` accepts a richer field-type set —
    // we pass our subset through verbatim. The platform handles
    // validation and returns the collected values keyed by the
    // field name (or null if the user cancelled).
    const result = await prompts.form({
      title: spec.title,
      icon: spec.icon,
      confirmText: spec.submitText,
      cancelText: spec.cancelText,
      fields: normalizeFormFields(spec.fields) as never,
    });
    return result as Record<string, unknown> | null;
  },
});

const normalizeFormFields = (fields: Record<string, KitFormField>): Record<string, KitFormField> => {
  const normalized: Record<string, KitFormField> = {};
  for (const [key, field] of Object.entries(fields)) {
    if (field.type === "textarea") {
      normalized[key] = {
        type: "text",
        label: field.label,
        placeholder: field.placeholder,
        required: field.required,
        default: field.default,
        multiline: true,
        lines: field.rows ?? field.lines,
      };
    } else {
      normalized[key] = field;
    }
  }
  return normalized;
};
