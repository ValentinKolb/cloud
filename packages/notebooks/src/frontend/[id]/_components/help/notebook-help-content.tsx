import { DocCode, DocConceptGrid, DocInlineCode, DocLead, DocNote, DocPage, DocRows, DocSection } from "@valentinkolb/cloud/ui";
import type { JSX } from "solid-js";
import { highlightFormula, NotebookFormulaReference } from "./notebook-formula-reference";
import { highlightScriptApi, NotebookScriptApiReference } from "./notebook-script-api-reference";

const code = (...lines: string[]) => lines.join("\n");

const NotebookDocPage = (props: { children: JSX.Element }) => <DocPage class="!mx-0 !max-w-none w-full">{props.children}</DocPage>;

const MarkdownSnippet = (props: { title: string; code: string }) => (
  <DocCode title={props.title} code={props.code} language="markdown" copy />
);

const ScriptSnippet = (props: { title: string; code: string }) => (
  <DocCode title={props.title} code={props.code} language="script" highlight={highlightScriptApi} copy />
);

const FormulaSnippet = (props: { title: string; code: string }) => (
  <DocCode title={props.title} code={props.code} highlight={highlightFormula} copy />
);

const noteStarter = code(
  "# Trip notes",
  "",
  "Use short paragraphs. Keep one idea per section.",
  "",
  "## Packing",
  "- [x] Passport",
  "- [ ] Charger",
  "- [ ] Rain jacket",
  "",
  "## Ideas",
  "- Visit the old town early",
  "- Keep one evening open",
);

const calloutStarter = code(
  "# Project brief",
  "",
  ":::info",
  "Use this box for context that readers should notice.",
  ":::",
  "",
  ":::success",
  "Decision: keep the first version small.",
  ":::",
  "",
  ":::warning",
  "Risk: waiting for final prices.",
  ":::",
);

const organizeStarter = code(
  "# Garden hub",
  "",
  "#garden #spring #planning",
  "",
  "Use /note to insert links. You do not need to find note ids by hand.",
  "",
  "- [Plant list](note://aB12Cd)",
  "- [Bed plan](note://xY98Qr)",
  "- [Seed order.pdf](attach://pQ45Rt)",
);

const attachmentStarter = code(
  "# Receipt",
  "",
  "Drag a file into the editor, paste an image, or type /file.",
  "",
  "Images render inline:",
  "",
  "![Tomato seedlings](attach://img123)",
  "",
  "Other files render as links:",
  "",
  "[Soil test.pdf](attach://pdf123)",
);

const tableStarter = code(
  "@plants",
  "| Plant | Bed | Status | Progress | Notes |",
  "|---|---|---|---|---|",
  "| Tomato Harzfeuer | Bed A | planted | =PROGRESS(2,4) | keep rain off leaves |",
  "| Bush bean | Bed B | next | =PROGRESS(0.25) | sow into warm soil |",
  "| Chives | Bed C | harvest | =PROGRESS(1) | leave some flowers |",
);

const dataStarter = code(
  "@recipe",
  ":::data",
  "servings: 4",
  "time: 35 min",
  "tags:",
  "  - bavarian",
  "  - weeknight",
  ":::",
  "",
  "@shopping",
  "- flour",
  "- eggs",
  "- mountain cheese",
  "",
  "@tasks",
  "- [ ] Grate cheese",
  "- [x] Slice onions",
);

const scriptLifecycleExample = code(
  "// 1. Read source data",
  'const ideas = current.table("ideas")?.rows ?? [];',
  "",
  "// 2. Render output",
  "ui.render(",
  '  ui.metric("Ideas", ideas.length, { icon: "ti ti-bulb" }),',
  '  ui.live(() => ui.table(current.table("ideas")?.rows ?? [])),',
  ");",
  "",
  "// 3. Add actions when needed",
  'ui.button("Add idea", async () => {',
  '  const title = await ui.prompt.text("Idea title");',
  '  if (title) await current.table("ideas")?.add(title, "new");',
  "}).show();",
);

const scriptDashboard = code(
  "```script",
  "ui.live(() => {",
  '  const plants = current.table("plants")?.rows ?? [];',
  '  const tasks = current.todo("tasks")?.items ?? [];',
  "  const open = tasks.filter((task) => !task.done);",
  "",
  "  return ui.row(",
  '    ui.metric("Plants", plants.length, { icon: "ti ti-plant-2", tone: "success" }),',
  '    ui.metric("Open tasks", open.length, { icon: "ti ti-checkbox", tone: "warning" }),',
  "  );",
  "}).show();",
  "```",
);

const scriptCreate = code(
  "ui.render(",
  '  ui.live(() => ui.table(current.table("ideas")?.rows ?? [], { emptyText: "No ideas yet." })),',
  '  ui.button("Add idea", async () => {',
  '    const title = await ui.prompt.text("Idea title", "", { title: "New idea" });',
  "    if (!title) return;",
  "",
  '    const note = await nb.create({ title, content: "# " + title + "\\n\\n#idea" });',
  '    await current.table("ideas")?.add(title, note, ["#idea"], "new");',
  '    ui.toast("Idea added", { variant: "success" });',
  "  }),",
  ");",
);

const chartExample = code(
  'const harvest = current.table("harvest")?.rows ?? [];',
  "",
  'ui.chart("bar", {',
  "  height: 220,",
  "  showValues: true,",
  "  data: harvest.map((row) => ({",
  "    label: row.Plant,",
  "    value: Number(row.Grams ?? 0),",
  "  })),",
  "}).show();",
);

const formExample = code(
  "const values = await ui.prompt.form({",
  '  title: "Add plant",',
  '  submitText: "Add",',
  "  fields: {",
  '    name: { type: "text", label: "Plant name", required: true, placeholder: "Tomato" },',
  '    notes: { type: "textarea", label: "Notes", rows: 3 },',
  '    count: { type: "number", label: "Seedlings", min: 0, default: 1 },',
  '    perennial: { type: "boolean", label: "Perennial", default: false },',
  '    status: { type: "select", label: "Status", options: ["planned", "sown", "planted"], default: "planned" },',
  "  },",
  "});",
  "",
  "if (!values) return;",
  'await current.table("plants")?.add(values.name, values.status, values.count, values.notes);',
  'ui.toast("Plant added", { variant: "success" });',
);

const searchExample = code(
  'const notes = await nb.search("#garden");',
  "",
  "ui.table(notes.map((note) => ({",
  "  note,",
  "  tags: note.tags,",
  "  openTasks: note.todos().flatMap((list) => list.items).filter((todo) => !todo.done).length,",
  "  updated: note.updatedAt,",
  "}))).show();",
);

const kvExample = code(
  "const slot = ui.col();",
  "slot.show();",
  "",
  "const render = () => {",
  '  const value = current.kv.get("counter") ?? 0;',
  "  slot.replaceChildren(",
  "    ui.row(",
  '      ui.text("Shared counter: " + value),',
  '      ui.button("+1", () => current.kv.set("counter", (current = 0) => current + 1)),',
  '      ui.button("Reset", () => current.kv.delete("counter")),',
  "    ),",
  "  );",
  "};",
  "",
  "render();",
  'current.kv.observe("counter", render);',
);

const attachmentExample = code(
  'const files = await nb.attachments.uploadFromPicker({ accept: "image/*", multiple: true });',
  "",
  "for (const file of files) {",
  "  await nb.attachments.insertIntoContent(file.id);",
  "}",
  "",
  'ui.toast(files.length + " file(s) inserted", { variant: "success" });',
);

export const NotebookStartHelp = () => (
  <NotebookDocPage>
    <DocLead>
      Notebooks are Markdown workspaces for knowledge that should stay readable first and become structured or automated only where that
      makes the note easier to use.
    </DocLead>

    <DocSection title="Work in layers" eyebrow="Overview">
      <DocRows
        items={[
          {
            title: "Write",
            icon: "ti-markdown",
            text: "Start with headings, paragraphs, tasks, links, and attachments. Plain Markdown stays understandable without tooling.",
          },
          {
            title: "Structure",
            icon: "ti-braces",
            text: (
              <>
                Add <DocInlineCode>@ref</DocInlineCode> blocks when scripts or formulas need stable data such as tables, todos, lists, or
                data blocks.
              </>
            ),
          },
          {
            title: "Automate",
            icon: "ti-code",
            text: "Use trusted script blocks when notebook data should become a dashboard, chart, button workflow, or small in-note tool.",
          },
          {
            title: "Reference",
            icon: "ti-api",
            text: "Use the formula and script API pages as the exact contract for users, CLI helpers, and future agents.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Common paths" eyebrow="Start here">
      <DocConceptGrid
        items={[
          {
            title: "Capture notes",
            icon: "ti-pencil",
            text: "Use Markdown for decisions, meeting notes, research, recipes, planning, and lightweight task lists.",
          },
          {
            title: "Connect knowledge",
            icon: "ti-link",
            text: "Use note links, tags, and attachments to make related information discoverable without moving everything into one file.",
          },
          {
            title: "Track small structured data",
            icon: "ti-table",
            text: "Use Markdown tables and named blocks for small datasets that benefit from being close to the prose around them.",
          },
          {
            title: "Build small tools",
            icon: "ti-layout-dashboard",
            text: "Use scripts for summaries, dashboards, charts, prompts, and buttons that operate on notebook data.",
          },
        ]}
      />
    </DocSection>
  </NotebookDocPage>
);

export const NotebookCoreModelHelp = () => (
  <NotebookDocPage>
    <DocLead>
      A notebook is a shared workspace. A note is the source document. Named blocks and scripts add structure around that source instead of
      replacing it.
    </DocLead>

    <DocSection title="The objects" eyebrow="Core model">
      <DocRows
        items={[
          {
            title: "Notebook",
            icon: "ti-notebook",
            text: "A workspace with notes, attachments, settings, permissions, exports, optional scripts, and notebook-local state.",
          },
          {
            title: "Note",
            icon: "ti-file-text",
            text: "A Markdown document that can contain prose, tasks, links, tables, data blocks, attachments, and script output.",
          },
          {
            title: "Note tree",
            icon: "ti-sitemap",
            text: "Notes can have parent notes. The sidebar uses that hierarchy for navigation.",
          },
          {
            title: "Tag",
            icon: "ti-tag",
            text: (
              <>
                A <DocInlineCode>#tag</DocInlineCode> parsed from note content and used by search, tag pages, and scripts.
              </>
            ),
          },
          {
            title: "Attachment",
            icon: "ti-paperclip",
            text: (
              <>
                A file uploaded to the notebook and referenced from Markdown with <DocInlineCode>attach://shortId</DocInlineCode>.
              </>
            ),
          },
          {
            title: "Named block",
            icon: "ti-braces",
            text: (
              <>
                A table, list, todo list, data block, or section marked with <DocInlineCode>@name</DocInlineCode> so scripts can read it.
              </>
            ),
          },
          {
            title: "Script",
            icon: "ti-code",
            text: "A trusted JavaScript block that reads notebook APIs and renders output in the note.",
          },
        ]}
      />
    </DocSection>

    <DocNote title="Source of truth" variant="tip">
      Keep important information visible in Markdown. Scripts and formulas should summarize or update readable source data, not hide the
      only copy of it.
    </DocNote>
  </NotebookDocPage>
);

export const NotebookWriteOrganizeHelp = () => (
  <NotebookDocPage>
    <DocLead>Write notes as readable Markdown, then use links, tags, attachments, and the sidebar to make the notebook navigable.</DocLead>

    <DocSection title="Write a useful note" eyebrow="Markdown">
      <DocRows
        items={[
          {
            title: "Headings",
            icon: "ti-heading",
            text: (
              <>
                Use <DocInlineCode>#</DocInlineCode>, <DocInlineCode>##</DocInlineCode>, and deeper headings to create sections.
              </>
            ),
          },
          {
            title: "Lists and tasks",
            icon: "ti-list-check",
            text: (
              <>
                Use <DocInlineCode>-</DocInlineCode> for lists and <DocInlineCode>- [ ]</DocInlineCode> or{" "}
                <DocInlineCode>- [x]</DocInlineCode> for tasks.
              </>
            ),
          },
          {
            title: "Slash menu",
            icon: "ti-command",
            text: "Use the editor insert menu for common blocks such as notes, files, tables, and scripts.",
          },
        ]}
      />
      <MarkdownSnippet title="Normal note" code={noteStarter} />
    </DocSection>

    <DocSection title="Callouts" eyebrow="Readable emphasis">
      <p>Use callouts for context, decisions, warnings, and status that should be visible while scanning a note.</p>
      <MarkdownSnippet title="Readable boxes" code={calloutStarter} />
    </DocSection>

    <DocSection title="Links, tags, and attachments" eyebrow="Organization">
      <DocRows
        items={[
          {
            title: "Note links",
            icon: "ti-link",
            text: (
              <>
                The Markdown form is <DocInlineCode>[Label](note://shortId)</DocInlineCode>, but the editor can insert links for you.
              </>
            ),
          },
          {
            title: "Tags",
            icon: "ti-tags",
            text: (
              <>
                Use <DocInlineCode>#garden</DocInlineCode> style tags for cross-note grouping. Tag filters match parsed tags, not arbitrary
                words.
              </>
            ),
          },
          {
            title: "Attachments",
            icon: "ti-paperclip",
            text: (
              <>
                Images render inline. Other files render as links. Both use <DocInlineCode>attach://shortId</DocInlineCode> references.
              </>
            ),
          },
        ]}
      />
      <MarkdownSnippet title="Hub note with links" code={organizeStarter} />
      <MarkdownSnippet title="Attachment references" code={attachmentStarter} />
    </DocSection>
  </NotebookDocPage>
);

export const NotebookStructuredBlocksHelp = () => (
  <NotebookDocPage>
    <DocLead>
      Named blocks are the bridge from readable notes to script-readable data. Put a stable <DocInlineCode>@ref</DocInlineCode> directly
      above the block that should become part of the public note structure.
    </DocLead>

    <DocSection title="The block contract" eyebrow="@ref">
      <DocRows
        items={[
          {
            title: "Stable names",
            icon: "ti-signature",
            text: (
              <>
                Use short lowercase names such as <DocInlineCode>@plants</DocInlineCode> or <DocInlineCode>@tasks</DocInlineCode>. Rename
                carefully because scripts call those names.
              </>
            ),
          },
          {
            title: "One name, one meaning",
            icon: "ti-alert-circle",
            text: "Do not reuse the same name for different concepts. Automation should not have to guess which block to use.",
          },
          {
            title: "Visible data",
            icon: "ti-eye",
            text: "Keep source data visible in Markdown so another user can understand the script without reading code first.",
          },
          {
            title: "Script access",
            icon: "ti-api",
            text: (
              <>
                Scripts read blocks with helpers such as <DocInlineCode>current.table("plants")</DocInlineCode>,{" "}
                <DocInlineCode>current.todo("tasks")</DocInlineCode>, and <DocInlineCode>current.data("recipe")</DocInlineCode>.
              </>
            ),
          },
        ]}
      />
    </DocSection>

    <DocSection title="Tables" eyebrow="Structured data">
      <p>Tables work well for small structured lists such as plants, recipes, contacts, books, tasks, or expenses.</p>
      <MarkdownSnippet title="Named table with formulas" code={tableStarter} />
    </DocSection>

    <DocSection title="Lists, todos, data, and sections" eyebrow="Other blocks">
      <DocRows
        items={[
          { title: "Table", icon: "ti-table", text: "Rows and columns. Scripts receive columns and row objects." },
          { title: "List", icon: "ti-list", text: "Bullet items. Useful for small named collections." },
          { title: "Todo", icon: "ti-checkbox", text: "Task items with done/content/line metadata." },
          { title: "Data", icon: "ti-database", text: "YAML-like data block parsed as an object." },
          { title: "Section", icon: "ti-section", text: "Named Markdown section that scripts can read or append to." },
        ]}
      />
      <MarkdownSnippet title="Data sources for scripts" code={dataStarter} />
    </DocSection>
  </NotebookDocPage>
);

export const NotebookTableFormulasHelp = () => (
  <NotebookDocPage>
    <DocLead>
      Table formulas turn Markdown table cells into computed values. They are intentionally small: write the formula in the cell and keep
      the source columns visible.
    </DocLead>

    <DocSection title="Small examples" eyebrow="Formula shape">
      <div class="grid gap-3 lg:grid-cols-3">
        <FormulaSnippet title="Progress" code="=PROGRESS(2, 10)" />
        <FormulaSnippet title="Column total" code="=SUM(Hours)" />
        <FormulaSnippet title="Conditional label" code={'=IF(Status == "done", "closed", "open")'} />
      </div>
    </DocSection>

    <NotebookFormulaReference />
  </NotebookDocPage>
);

export const NotebookScriptsHelp = () => (
  <NotebookDocPage>
    <DocLead>
      Scripts are trusted JavaScript blocks for small notebook apps. Use them when named blocks, tags, notes, or attachments should become
      interactive output.
    </DocLead>

    <DocNote title="Scripts are trusted code" variant="warning">
      Script blocks run in the browser of users who open the note. They can use browser APIs, read notebook content visible to that user,
      and perform notebook actions with that user's permissions.
    </DocNote>

    <DocSection title="Build in this order" eyebrow="Script workflow">
      <DocRows
        items={[
          { title: "Read", icon: "ti-database", text: "Read named blocks, tags, notes, attachments, or state through the public API." },
          {
            title: "Render",
            icon: "ti-layout-dashboard",
            text: "Render the smallest useful output first: metric, table, chart, note list, or Markdown.",
          },
          { title: "Act", icon: "ti-click", text: "Add buttons and prompts after the read path is clear." },
          {
            title: "Keep context",
            icon: "ti-message",
            text: "Leave names, headings, and descriptions in the note so people and agents can understand why the script exists.",
          },
        ]}
      />
      <ScriptSnippet title="Small script structure" code={scriptLifecycleExample} />
    </DocSection>

    <DocSection title="Useful patterns" eyebrow="Examples">
      <div class="grid gap-4 xl:grid-cols-2">
        <MarkdownSnippet title="Live dashboard from note data" code={scriptDashboard} />
        <ScriptSnippet title="Button workflow" code={scriptCreate} />
        <ScriptSnippet title="Chart from a table" code={chartExample} />
        <ScriptSnippet title="Search notes and render a table" code={searchExample} />
        <ScriptSnippet title="Full form example" code={formExample} />
        <ScriptSnippet title="Shared current.kv state" code={kvExample} />
        <ScriptSnippet title="Upload and insert attachments" code={attachmentExample} />
      </div>
    </DocSection>
  </NotebookDocPage>
);

export const NotebookScriptApiHelp = () => (
  <NotebookDocPage>
    <DocLead>
      Script blocks expose four globals: <DocInlineCode>current</DocInlineCode>, <DocInlineCode>nb</DocInlineCode>,{" "}
      <DocInlineCode>ui</DocInlineCode>, and <DocInlineCode>std</DocInlineCode>. Type a namespace and a dot in a script block to use
      autocomplete.
    </DocLead>

    <NotebookScriptApiReference />
  </NotebookDocPage>
);

export const NotebookSettingsHelp = () => (
  <NotebookDocPage>
    <DocLead>
      Notebook settings control the workspace around the notes: name, navigation mode, scripting, exports, access, and dangerous actions.
    </DocLead>

    <DocSection title="Settings tabs" eyebrow="Admin and workspace settings">
      <DocRows
        items={[
          { title: "General", icon: "ti-id", text: "Name, icon, description, and default start page." },
          { title: "View & features", icon: "ti-toggle-right", text: "Sidebar mode and notebook-level behavior such as script blocks." },
          {
            title: "Export",
            icon: "ti-download",
            text: "Download a portable notebook archive and configure snapshot export when available.",
          },
          { title: "Access", icon: "ti-shield", text: "Admin-only permission editor. Permission changes save immediately." },
          {
            title: "Danger zone",
            icon: "ti-alert-triangle",
            text: "Admin-only destructive actions such as deleting the notebook and its notes.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Script feature flag" eyebrow="Safety">
      <DocNote title="Enable scripts only for trusted notebooks" variant="warning">
        Scripts run in each viewer's browser and can perform notebook actions with that viewer's permissions. Keep scripting disabled when
        editors or note content are not trusted.
      </DocNote>
    </DocSection>
  </NotebookDocPage>
);

export const NotebookOperationsHelp = () => (
  <NotebookDocPage>
    <DocLead>
      Most Notebooks issues come from one of four contracts: Markdown syntax, stable <DocInlineCode>@ref</DocInlineCode> names, enabled
      scripts, or notebook-scoped permissions.
    </DocLead>

    <DocSection title="Common symptoms" eyebrow="Troubleshooting">
      <DocRows
        items={[
          {
            title: "A script cannot find a table",
            icon: "ti-table-off",
            text: (
              <>
                Check that the table has a stable <DocInlineCode>@name</DocInlineCode> directly above it and that the script uses the same
                name.
              </>
            ),
          },
          {
            title: "A formula shows an error",
            icon: "ti-alert-circle",
            text: "Check function spelling, argument count, column names, and circular references. Column names with spaces need backticks.",
          },
          {
            title: "A script does not run",
            icon: "ti-code-off",
            text: "Check that script blocks are enabled in notebook settings and that the code is inside a script fence.",
          },
          {
            title: "Search misses a note",
            icon: "ti-search-off",
            text: "Tags are parsed from #tag markers. Structured tag filters require all listed tags to be present.",
          },
          {
            title: "An attachment is missing",
            icon: "ti-paperclip",
            text: (
              <>
                Confirm the file exists in the notebook and that the Markdown reference uses <DocInlineCode>attach://shortId</DocInlineCode>
                .
              </>
            ),
          },
          {
            title: "A script writes the wrong place",
            icon: "ti-pencil-off",
            text: "current writes update the note containing the script. nb.update changes note metadata, not another note body.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Debug path" eyebrow="When stuck">
      <DocRows
        items={[
          { title: "Read the note first", icon: "ti-eye", text: "Make sure the raw Markdown contains the data you expect." },
          {
            title: "Check named blocks",
            icon: "ti-braces",
            text: "Verify @ref names and use plural helpers such as current.tables() for discovery.",
          },
          {
            title: "Use small scripts",
            icon: "ti-code",
            text: "Start with ui.text or ui.table before adding buttons, prompts, charts, or writes.",
          },
          {
            title: "Keep changes reviewable",
            icon: "ti-history",
            text: "Prefer Markdown updates and named blocks over hidden state when other users need to understand the result.",
          },
        ]}
      />
    </DocSection>
  </NotebookDocPage>
);
