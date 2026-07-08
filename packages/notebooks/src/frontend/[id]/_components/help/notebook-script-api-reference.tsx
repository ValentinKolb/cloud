import { DocCode, DocInlineCode, type DocRow, DocRows, DocSection } from "@valentinkolb/cloud/ui";
import { For, type JSX } from "solid-js";

type ApiEntry = {
  name: string;
  signature: string;
  returns: string;
  text: JSX.Element;
};

type ApiGroup = {
  title: string;
  intro: string;
  entries: ApiEntry[];
};

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const span = (className: string, value: string): string => `<span class="${className}">${escapeHtml(value)}</span>`;

export const highlightScriptApi = (source: string): string => {
  const pattern =
    /(\.\.\.|"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|`(?:\\.|[^`])*`|\b(?:await|async|void|boolean|string|number|object|null|undefined|Promise|Record|File|Blob|HTMLElement|KitNote|KitElement|KitChild|unknown)\b|\b(?:current|nb|ui|std)\b|\.[A-Za-z_$][\w$]*|[A-Za-z_$][\w$]*(?=\()|[(){}[\],.?/|:<>])/g;
  let output = "";
  let last = 0;

  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) output += escapeHtml(source.slice(last, index));
    const token = match[0];
    if (
      /^(await|async|void|boolean|string|number|object|null|undefined|Promise|Record|File|Blob|HTMLElement|KitNote|KitElement|KitChild|unknown)$/.test(
        token,
      )
    ) {
      output += span("text-red-600 dark:text-red-400", token);
    } else if (/^(current|nb|ui|std)$/.test(token)) {
      output += span("text-blue-700 dark:text-blue-300", token);
    } else if (/^["'`]/.test(token)) {
      output += span("text-emerald-700 dark:text-emerald-300", token);
    } else if (/^\.[A-Za-z_$]/.test(token) || /^[A-Za-z_$][\w$]*(?=\()/.test(token)) {
      output += span("text-violet-700 dark:text-violet-300", token);
    } else if (/^[(){}[\],.?/|:<>]$|^\.\.\.$/.test(token)) {
      output += span("text-zinc-500 dark:text-zinc-500", token);
    } else {
      output += escapeHtml(token);
    }
    last = index + token.length;
  }

  return output + escapeHtml(source.slice(last));
};

const entry = (name: string, signature: string, returns: string, text: JSX.Element): ApiEntry => ({ name, signature, returns, text });

const apiContractRows: DocRow[] = [
  {
    title: "No imports",
    icon: "ti-plug-connected",
    text: (
      <>
        Script blocks use exposed globals only: <DocInlineCode>current</DocInlineCode>, <DocInlineCode>nb</DocInlineCode>,{" "}
        <DocInlineCode>ui</DocInlineCode>, and <DocInlineCode>std</DocInlineCode>.
      </>
    ),
  },
  {
    title: "Current notebook boundary",
    icon: "ti-notebook",
    text: "The nb APIs are scoped to the current notebook. There is no parameter for reading another notebook.",
  },
  {
    title: "Short note ids",
    icon: "ti-id",
    text: (
      <>
        Note ids in <DocInlineCode>nb</DocInlineCode> calls are the short ids used in note URLs and <DocInlineCode>note://</DocInlineCode>{" "}
        links.
      </>
    ),
  },
  {
    title: "Bounded reads",
    icon: "ti-scale",
    text: (
      <>
        Structured searches default to <DocInlineCode>limit: 50</DocInlineCode> and cap at <DocInlineCode>200</DocInlineCode>. Search can
        mark large client-side results with <DocInlineCode>__truncated</DocInlineCode>.
      </>
    ),
  },
];

const currentGroups: ApiGroup[] = [
  {
    title: "current metadata",
    intro: "Read properties of the note that contains the script.",
    entries: [
      entry("id", "current.id", "string", "Short note id."),
      entry("title", "current.title", "string", "Current note title."),
      entry("content", "current.content", "string", "Current Markdown content."),
      entry("tags", "current.tags", "string[]", "Tags parsed from current content."),
      entry("notebook", "current.notebook", "{ id: string; name: string }", "Current notebook identity."),
      entry("createdAt", "current.createdAt", "string", "Creation timestamp."),
      entry("updatedAt", "current.updatedAt", "string", "Last update timestamp."),
      entry("lockedAt", "current.lockedAt", "string | null", "Lock timestamp, or null when the note is not locked."),
    ],
  },
  {
    title: "current writes",
    intro: "These methods update the note that hosts the script. Write methods are edit-mode APIs.",
    entries: [
      entry("setTitle", "await current.setTitle(title)", "void", "Rename the current note."),
      entry("setContent", "await current.setContent(markdown)", "void", "Replace the entire Markdown body."),
      entry("appendContent", "await current.appendContent(markdown)", "void", "Append Markdown and keep paragraph spacing readable."),
      entry("prependContent", "await current.prependContent(markdown)", "void", "Prepend Markdown at the start of the note."),
      entry(
        "insertContentAt",
        "await current.insertContentAt({ line, col? }, markdown)",
        "void",
        "Insert Markdown at a 0-based line and optional column.",
      ),
      entry(
        "replaceLine",
        "await current.replaceLine(line, text)",
        "void",
        "Replace one 0-based line without changing the rest of the note.",
      ),
    ],
  },
  {
    title: "named blocks on current",
    intro:
      "Singular helpers return the first matching named block or undefined. Plural helpers return arrays and can be called without a name.",
    entries: [
      entry(
        "table",
        'current.table("ideas")',
        "table | undefined",
        "Read or update a named Markdown table. Writable table views support add(...cells).",
      ),
      entry("tables", "current.tables(name?)", "table[]", "List named tables. Omit name to list all table blocks."),
      entry(
        "list",
        'current.list("shopping")',
        "list | undefined",
        "Read or update a named bullet list. Writable list views support add(...items).",
      ),
      entry("lists", "current.lists(name?)", "list[]", "List named bullet lists."),
      entry(
        "todo",
        'current.todo("tasks")',
        "todo | undefined",
        "Read or update a named task list. Todo items expose done, content, and line.",
      ),
      entry("todos", "current.todos(name?)", "todo[]", "List named task blocks."),
      entry(
        "data",
        'current.data("recipe")',
        "data | undefined",
        "Read or replace a named data block. Writable data views support set(object).",
      ),
      entry("dataBlocks", "current.dataBlocks(name?)", "data[]", "List named data blocks."),
      entry("section", 'current.section("log")', "section | undefined", "Read or append to a named Markdown section."),
      entry("sections", "current.sections(name?)", "section[]", "List named sections."),
    ],
  },
];

const notebookGroups: ApiGroup[] = [
  {
    title: "nb notes",
    intro: "Search and manage notes inside the current notebook.",
    entries: [
      entry("list", "await nb.list()", "note[]", "List notes in the current notebook."),
      entry("get", "await nb.get(shortId)", "note | null", "Fetch one note by short id."),
      entry("search", "await nb.search(query)", "note[]", "Search by string or structured query."),
      entry("searchTags", "await nb.searchTags(tagOrTags, options?)", "note[]", "Find notes containing all provided tags."),
      entry("create", "await nb.create({ title, parentId?, content? })", "note", "Create a note. parentId is a short note id."),
      entry("update", "await nb.update(shortId, { title?, parentId? })", "note", "Update note title or parent."),
      entry("remove", "await nb.remove(shortId)", "void", "Remove a note by short id."),
    ],
  },
  {
    title: "nb attachments",
    intro: "Upload, list, insert, and remove attachments scoped to the current notebook.",
    entries: [
      entry("list", "await nb.attachments.list()", "attachment[]", "List all uploaded attachments in the notebook."),
      entry("listInNote", "await nb.attachments.listInNote()", "attachment[]", "List attachments referenced by the current note content."),
      entry("get", "await nb.attachments.get(shortId)", "attachment | null", "Fetch an attachment by short id."),
      entry("upload", "await nb.attachments.upload(file, filename?)", "attachment", "Upload a File or Blob. Blob uploads need a filename."),
      entry(
        "uploadFromPicker",
        "await nb.attachments.uploadFromPicker({ accept?, multiple? })",
        "attachment[]",
        "Open the browser file picker and upload selected files.",
      ),
      entry(
        "insertIntoContent",
        "await nb.attachments.insertIntoContent(shortId)",
        "void",
        "Append a Markdown attachment link or image reference to the current note.",
      ),
      entry("remove", "await nb.attachments.remove(shortId)", "void", "Remove an attachment by short id."),
    ],
  },
  {
    title: "nb tags",
    intro: "Read the notebook tag index.",
    entries: [
      entry("list", "await nb.tags.list()", "{ tag: string; count: number }[]", "List all tags used in the notebook with note counts."),
      entry("notesForTag", "await nb.tags.notesForTag(tag)", "note[]", "Find notes that reference one tag."),
    ],
  },
];

const stateGroups: ApiGroup[] = [
  {
    title: "current.kv",
    intro: "Collaborative per-current-note state. Calls are synchronous and shared with collaborators.",
    entries: [
      entry("get", 'current.kv.get("key")', "value | undefined", "Read one key."),
      entry("set", 'current.kv.set("key", valueOrUpdater)', "void", "Set one key. The value can be a value or updater function."),
      entry("delete", 'current.kv.delete("key")', "void", "Delete one key."),
      entry("keys", "current.kv.keys()", "string[]", "List keys sorted alphabetically."),
      entry(
        "observe",
        'current.kv.observe("key", callback)',
        "() => void",
        "Subscribe to changes for one key and receive an unsubscribe function.",
      ),
    ],
  },
  {
    title: "nb.localKV",
    intro: "Private per-user, per-notebook state. Calls are async and persisted locally in the browser.",
    entries: [
      entry("get", 'await nb.localKV.get("key")', "value | undefined", "Read one private key."),
      entry("set", 'await nb.localKV.set("key", valueOrUpdater)', "void", "Set one private key."),
      entry("delete", 'await nb.localKV.delete("key")', "void", "Delete one private key."),
      entry("keys", "await nb.localKV.keys()", "string[]", "List private keys for this notebook namespace."),
      entry("observe", 'nb.localKV.observe("key", callback)', "() => void", "Subscribe to same-tab and cross-tab changes for one key."),
    ],
  },
];

const uiGroups: ApiGroup[] = [
  {
    title: "ui layout and content",
    intro: "Build visible output for the script block.",
    entries: [
      entry("row", "ui.row(...children)", "element", "Horizontal flex row. Children wrap when they do not fit."),
      entry("col", "ui.col(...children)", "element", "Vertical flex column."),
      entry("card", "ui.card(...children)", "element", "Padded visual group for related content."),
      entry("metric", "ui.metric(label, value, options?)", "element", "Compact dashboard metric card."),
      entry("divider", "ui.divider()", "element", "Horizontal rule."),
      entry("text", "ui.text(content)", "element", "Plain paragraph text."),
      entry("heading", "ui.heading(content, level?)", "element", "Heading level 1-6. Default level is 2."),
      entry("md", "ui.md(markdown)", "element", "Render Markdown through the same read-mode engine."),
      entry("html", "ui.html(rawHtml)", "element", "Trusted-script escape hatch. The string is set as raw HTML."),
    ],
  },
  {
    title: "ui data views",
    intro: "Render notebook data as links, tables, and charts.",
    entries: [
      entry("noteLink", "ui.noteLink(noteOrShortId, label?)", "element", "Render a clickable link to a note."),
      entry("noteList", "ui.noteList(notes, options?)", "element", "Render notes as a compact note-link list."),
      entry("table", "ui.table(rowsOrTable, options?)", "element", "Render rows or a KitTableView using the notebook table surface."),
      entry(
        "chart",
        "ui.chart(kind, options)",
        "element",
        "Render a stdlib SVG chart. Width is measured from the container; height is configurable.",
      ),
    ],
  },
  {
    title: "ui actions and mounting",
    intro: "Attach actions and mount output.",
    entries: [
      entry("button", "ui.button(label, onClick, options?)", "element", "Render a button. Async errors are caught and shown inline."),
      entry("toast", "ui.toast(description, options?)", "void", "Show a platform toast. This is not mounted into the script output."),
      entry(
        "live",
        "ui.live(render)",
        "element",
        "Render a small reactive slot. In edit mode it reruns when current note content changes.",
      ),
      entry("render", "ui.render(...elements)", "void", "Mount one or more elements into the script output."),
      entry("show", "element.show()", "void", "Every ui element can mount itself into the script output."),
    ],
  },
  {
    title: "ui.prompt",
    intro: "Open platform prompts from a script.",
    entries: [
      entry("alert", "await ui.prompt.alert(message, options?)", "void", "Show an informational dialog."),
      entry("confirm", "await ui.prompt.confirm(message, options?)", "boolean", "Show a confirm dialog."),
      entry("text", "await ui.prompt.text(message, defaultValue?, options?)", "string | null", "Ask for one text value."),
      entry(
        "form",
        "await ui.prompt.form(spec)",
        "object | null",
        "Ask for multiple values. Fields support text, textarea, number, boolean, and select.",
      ),
    ],
  },
];

const stdRows: DocRow[] = [
  {
    title: "std.text",
    icon: "ti-typography",
    text: "String helpers such as slugify, humanize, truncate, case conversion, and pprintBytes.",
  },
  { title: "std.dates", icon: "ti-calendar", text: "Date/time formatting and calendar utilities." },
  { title: "std.fuzzy", icon: "ti-search", text: "Fuzzy search and typo correction helpers." },
  { title: "std.crypto", icon: "ti-lock", text: "Hashing, UUID/readable ids, asymmetric/symmetric crypto, and TOTP helpers." },
  { title: "std.encoding", icon: "ti-binary", text: "Base64, Hex, and Base62 string conversions." },
  { title: "std.charts", icon: "ti-chart-bar", text: "Low-level SVG chart generators. Prefer ui.chart for mounted output." },
  { title: "std.qr", icon: "ti-qrcode", text: "QR-code generators and SVG rendering." },
  { title: "std.password", icon: "ti-key", text: "Password generators and strength analysis." },
  { title: "std.timing", icon: "ti-clock", text: "Async timing helpers such as sleep, debounce, throttle, jitter, and withMinLoadTime." },
  { title: "std.files", icon: "ti-file", text: "Browser file downloads, ZIP archives, file/folder pickers, and MIME helpers." },
  { title: "std.images", icon: "ti-photo", text: "Browser image processing pipeline helpers." },
  { title: "std.clipboard", icon: "ti-clipboard", text: "Script-facing clipboard facade with copy(text)." },
];

const ApiGroupView = (props: ApiGroup) => (
  <section class="overflow-hidden rounded-md bg-zinc-50/60 ring-1 ring-inset ring-zinc-200/70 dark:bg-zinc-900/25 dark:ring-zinc-800">
    <header class="px-3 py-3">
      <p class="font-semibold text-primary">{props.title}</p>
      <p class="mt-1 text-sm text-dimmed">{props.intro}</p>
    </header>
    <div class="divide-y divide-zinc-200/70 dark:divide-zinc-800">
      <For each={props.entries}>
        {(item) => (
          <article class="grid gap-3 px-3 py-3 text-sm lg:grid-cols-[minmax(9rem,0.65fr)_minmax(16rem,1.15fr)_minmax(14rem,1fr)]">
            <div>
              <p class="font-semibold text-primary">{item.name}</p>
              <p class="mt-1 text-xs text-dimmed">Returns: {item.returns}</p>
            </div>
            <DocCode code={item.signature} highlight={highlightScriptApi} />
            <div class="text-dimmed">{item.text}</div>
          </article>
        )}
      </For>
    </div>
  </section>
);

export const NotebookScriptApiReference = () => (
  <div class="space-y-6">
    <DocSection title="Runtime contract" eyebrow="Script API">
      <DocRows items={apiContractRows} />
    </DocSection>

    <DocSection title="current" eyebrow="Current note">
      <div class="space-y-4">
        <For each={currentGroups}>{(group) => <ApiGroupView {...group} />}</For>
      </div>
    </DocSection>

    <DocSection title="nb" eyebrow="Notebook API">
      <div class="space-y-4">
        <For each={notebookGroups}>{(group) => <ApiGroupView {...group} />}</For>
      </div>
    </DocSection>

    <DocSection title="State APIs" eyebrow="KV">
      <div class="space-y-4">
        <For each={stateGroups}>{(group) => <ApiGroupView {...group} />}</For>
      </div>
    </DocSection>

    <DocSection title="ui" eyebrow="Rendering and interaction">
      <div class="space-y-4">
        <For each={uiGroups}>{(group) => <ApiGroupView {...group} />}</For>
      </div>
    </DocSection>

    <DocSection title="std" eyebrow="Curated stdlib">
      <DocRows items={stdRows} />
    </DocSection>
  </div>
);
