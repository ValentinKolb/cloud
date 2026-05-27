import { CodeDisplay, type CodeDisplayLanguage } from "@valentinkolb/cloud/ui";
import { Layout } from "@valentinkolb/cloud/ssr/islands";
import { type JSX } from "solid-js";

type ApiMethodProps = {
  name: string;
  signature: string;
  returns: string;
  children: JSX.Element;
};

const Info = (props: { children: JSX.Element }) => (
  <div class="info-block-info my-3 flex items-start gap-2 text-xs">
    <i class="ti ti-info-circle mt-0.5 shrink-0" />
    <div>{props.children}</div>
  </div>
);

const Tip = (props: { children: JSX.Element }) => (
  <div class="info-block-success my-3 flex items-start gap-2 text-xs">
    <i class="ti ti-bulb mt-0.5 shrink-0" />
    <div>{props.children}</div>
  </div>
);

const Warning = (props: { children: JSX.Element }) => (
  <div class="info-block-warning my-3 flex items-start gap-2 text-xs">
    <i class="ti ti-alert-triangle mt-0.5 shrink-0" />
    <div>{props.children}</div>
  </div>
);

const Section = (props: { title: string; icon: string; children: JSX.Element }) => (
  <section class="space-y-3">
    <h4 class="mt-7 flex items-center gap-2 text-sm font-semibold text-primary first:mt-0">
      <i class={`ti ${props.icon} text-blue-500`} />
      {props.title}
    </h4>
    {props.children}
  </section>
);

const InlineCode = (props: { children: JSX.Element }) => (
  <code class="rounded bg-zinc-100 px-1 py-px font-mono text-[11px] text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
    {props.children}
  </code>
);

const Snippet = (props: { title: string; code: string; language?: CodeDisplayLanguage }) => (
  <CodeDisplay title={props.title} code={props.code} language={props.language ?? "markdown"} copy lineNumbers />
);

const MiniGrid = (props: { children: JSX.Element }) => <div class="grid gap-2 text-xs sm:grid-cols-2">{props.children}</div>;

const MiniCard = (props: { title: string; children: JSX.Element }) => (
  <div class="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900/60">
    <p class="font-semibold text-primary">{props.title}</p>
    <p class="mt-1 text-dimmed">{props.children}</p>
  </div>
);

const ApiMethod = (props: ApiMethodProps) => (
  <article class="rounded-lg bg-zinc-50 p-3 text-xs dark:bg-zinc-900/60">
    <div class="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
      <p class="font-semibold text-primary">{props.name}</p>
      <code class="font-mono text-[11px] text-blue-700 dark:text-blue-300">{props.signature}</code>
    </div>
    <p class="mt-1 text-dimmed">
      <span class="font-medium text-zinc-600 dark:text-zinc-300">Returns:</span> {props.returns}
    </p>
    <div class="mt-2 space-y-1 text-dimmed">{props.children}</div>
  </article>
);

const ApiCardGrid = (props: { children: JSX.Element }) => <div class="grid gap-2 lg:grid-cols-2">{props.children}</div>;

const markdownBasics = `# Project plan

Use short, clear notes. Add links when a detail deserves its own page.

## Tasks
- [ ] Write first draft
- [ ] Review with the team
- [x] Collect ideas

#planning #work`;

const richMarkdownSnippet = `# Garden page

:::info
Use this box for context that should stand out.
:::

:::success
Decision: keep the first version small.
:::

:::warning
Check frost dates before planting young tomatoes.
:::

[Open the seed list](note://abc123)

Inline math: $E = mc^2$

\`\`\`mermaid
graph TD
  Idea --> Plan
  Plan --> Done
\`\`\``;

const noteLinksSnippet = `# Project hub

Use note links when one idea deserves its own page.
You can insert them with the /note command.

- [Sprint plan](note://aB12Cd)
- [Meeting notes](note://xY98Qr)
- [Research inbox](note://mN45Op)

You do not need to copy ids by hand.`;

const tagsSnippet = `# Garden ideas

#garden #spring #planning

Use tags for groups that cut across the note tree:

- #garden for all garden notes
- #recipe for cooking notes
- #waiting for blocked work
- #person for CRM-like notes`;

const tableSnippet = `@ideas
| Idea | Status | Progress | Hours |
|---|---|---|---:|
| Write outline | active | =PROGRESS(1,3) | 2 |
| Review with team | waiting | =PROGRESS(0.25) | 1 |
| Polish | next | =PROGRESS(0,2) | 3 |
| Total | | | =SUM(Hours) |`;

const blocksSnippet = `@shopping
- flour
- eggs
- butter

@tasks
- [ ] Call the bakery
- [x] Buy apples

@recipe
:::data
servings: 4
prep: 20 min
tags:
  - bavarian
  - family
:::

## @notes
Add notes here. Scripts can append to this section.`;

const dashboardSnippet =
  '```script\nui.render(\n  ui.heading("Notebook dashboard", 2),\n  ui.live(() => {\n    const ideas = current.table("ideas");\n    const tasks = current.todo("tasks");\n    const recipe = current.data("recipe")?.value ?? {};\n\n    return ui.row(\n      ui.card(ui.heading("Ideas", 3), ui.text(String(ideas?.rows.length ?? 0))),\n      ui.card(ui.heading("Open tasks", 3), ui.text(String(tasks?.items.filter((t) => !t.done).length ?? 0))),\n      ui.card(ui.heading("Servings", 3), ui.text(String(recipe.servings ?? "-"))),\n    );\n  }),\n);\n```';

const searchSnippet =
  '```script\nconst notes = await nb.search("#garden");\n\nawait ui.table(notes.map((note) => ({\n  note,\n  tags: note.tags,\n  openTasks: note.todos().flatMap((list) => list.items).filter((todo) => !todo.done).length,\n}))).show();\n```';

const createSnippet =
  '```script\nui.render(\n  ui.live(() => ui.table(current.table("ideas")?.rows ?? [], { emptyText: "No ideas yet." })),\n  ui.button("Add idea", async () => {\n    const title = await ui.prompt.text("New idea title");\n    if (!title) return;\n\n    const note = await nb.create({ title, content: "# " + title + "\\n\\n#idea" });\n    await current.table("ideas")?.add(title, note, "new", 0);\n    ui.toast("Idea added", { variant: "success" });\n  }),\n);\n```';

const chartSnippet =
  '```script\nui.live(() => {\n  const harvest = current.table("harvest")?.rows ?? [];\n  return ui.chart("bar", {\n    height: 220,\n    data: harvest.map((row) => ({\n      label: row.Plant,\n      value: Number(row.Grams ?? 0),\n    })),\n  });\n}).show();\n```';

const stateSnippet =
  '```script\nconst KEY = "clicks";\nconst render = async () => {\n  const clicks = (await nb.localKV.get(KEY)) ?? 0;\n  slot.replaceChildren(\n    ui.row(\n      ui.text("Personal clicks: " + clicks),\n      ui.button("+1", async () => {\n        await nb.localKV.set(KEY, (current = 0) => current + 1);\n        await render();\n      }),\n    ),\n  );\n};\n\nconst slot = ui.col();\nslot.show();\nawait render();\n```';

const attachmentsSnippet =
  '```script\nconst picked = await nb.attachments.uploadFromPicker({ accept: "image/*", multiple: true });\n\nfor (const file of picked) {\n  await nb.attachments.insertIntoContent(file.id);\n}\n\nui.toast(`${picked.length} file(s) inserted`, { variant: "success" });\n```';

const setupSnippet = `@ideas
| Idea | Note | Status | Progress |
|---|---|---|---|
| Build dashboard | | active | =PROGRESS(1,3) |

@tasks
- [ ] Add one useful row
- [ ] Try the script button

\`\`\`script
ui.render(
  ui.live(() => ui.table(current.table("ideas")?.rows ?? [])),
  ui.button("Add idea", async () => {
    const title = await ui.prompt.text("Idea title");
    if (!title) return;
    const note = await nb.create({ title, content: "# " + title + "\\n\\n#idea" });
    await current.table("ideas")?.add(title, note, "new", "=PROGRESS(0,1)");
  }),
);
\`\`\``;

const OverviewTab = () => (
  <div class="space-y-5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
    <p>
      Notebooks are shared spaces for plain text notes. They are useful for normal writing, but they can also become small tools:
      dashboards, trackers, recipe books, garden planners, reading lists, and more.
    </p>

    <Section title="Start with plain Markdown" icon="ti-markdown">
      <p>
        Markdown is text with small marks for structure. You type <InlineCode># Title</InlineCode> for a heading,{" "}
        <InlineCode>- item</InlineCode> for a list, and <InlineCode>[label](url)</InlineCode> for a link.
      </p>
      <Info>
        The important part: the note still reads like normal text. You can copy it, search it, sync it, diff it, and edit it without a
        special document format.
      </Info>
      <Snippet title="A small note" code={markdownBasics} />
    </Section>

    <Section title="Common marks" icon="ti-list-details">
      <MiniGrid>
        <MiniCard title="Headings">
          <InlineCode># Title</InlineCode>, <InlineCode>## Section</InlineCode>, <InlineCode>### Detail</InlineCode>
        </MiniCard>
        <MiniCard title="Emphasis">
          <InlineCode>**bold**</InlineCode>, <InlineCode>*italic*</InlineCode>, <InlineCode>~~done~~</InlineCode>
        </MiniCard>
        <MiniCard title="Tasks">
          <InlineCode>- [ ] todo</InlineCode> and <InlineCode>- [x] done</InlineCode>
        </MiniCard>
        <MiniCard title="Tags">
          <InlineCode>#garden</InlineCode> makes a searchable tag.
        </MiniCard>
        <MiniCard title="Note links">
          <InlineCode>[Plan](note://abc123)</InlineCode> opens a note by short id.
        </MiniCard>
        <MiniCard title="Insert menu">
          Type <InlineCode>/</InlineCode> on an empty line to insert tables, data blocks, scripts, files, and more.
        </MiniCard>
      </MiniGrid>
    </Section>

    <Section title="Note-to-note links" icon="ti-link">
      <p>
        Note links connect pages inside the same notebook. They use short ids, so links stay small and readable. A link looks like{" "}
        <InlineCode>[Label](note://abc123)</InlineCode>. The label is what readers see. The id is the target note.
      </p>
      <Info>
        You usually do not type this by hand. Type <InlineCode>/note</InlineCode>, search for the target note, and pick it from the menu.
        The editor inserts the correct link for you.
      </Info>
      <p>
        Use note links when a note becomes too large, when one row in a table needs more detail, or when a dashboard should open a source
        note. In rendered Markdown and script tables, note links render as compact blue pills.
      </p>
      <Snippet title="A small hub page" code={noteLinksSnippet} />
      <Tip>
        Prefer note links over copying the same information into many places. Keep the detail in one note and link to it from tables,
        dashboards, and summaries.
      </Tip>
    </Section>

    <Section title="Tags" icon="ti-tags">
      <p>
        Tags are simple labels. Type <InlineCode>#garden</InlineCode> or <InlineCode>#waiting</InlineCode> anywhere in a note. The notebook
        indexes them automatically, so search, the sidebar tag list, and scripts can find related notes.
      </p>
      <p>
        Tags work best for groups that are not a strict tree. A note can live under one parent, but it can have many tags: project, status,
        topic, person, season, or workflow.
      </p>
      <Snippet title="Useful tag patterns" code={tagsSnippet} />
      <MiniGrid>
        <MiniCard title="Search by tag">
          Search for <InlineCode>#garden</InlineCode> to find all garden notes.
        </MiniCard>
        <MiniCard title="Use tags in scripts">
          <InlineCode>await nb.search("#garden")</InlineCode> returns matching notes.
        </MiniCard>
      </MiniGrid>
      <Warning>
        Keep tag names boring and consistent. <InlineCode>#garden</InlineCode> and <InlineCode>#gardening</InlineCode> are different tags.
      </Warning>
    </Section>

    <Section title="Readable boxes and rich blocks" icon="ti-info-square-rounded">
      <p>
        Use boxes when a paragraph should stand out. They are good for hints, decisions, warnings, and summaries. You can also add math and
        diagrams when a note needs them.
      </p>
      <Snippet title="Boxes, links, math, and Mermaid" code={richMarkdownSnippet} />
    </Section>

    <Section title="A tiny app in one note" icon="ti-apps">
      <p>
        A useful notebook app usually has three parts: a small data source, a script that reads it, and one or two buttons that update the
        note. Start small and let the dashboard grow only when it earns its place.
      </p>
      <Snippet title="Copy this into a note" code={setupSnippet} />
      <Tip>Keep source data easy to edit by hand. Use scripts for summaries and workflows, not for hiding all information behind code.</Tip>
    </Section>
  </div>
);

const AdvancedTab = () => (
  <div class="space-y-5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
    <p>
      Advanced blocks let scripts read and update structured parts of the current note. Put an <InlineCode>@ref</InlineCode> line above a
      table, list, data block, todo list, or section. Scripts can then find it by name.
    </p>

    <Section title="Named tables" icon="ti-table">
      <p>
        Tables are the best place for small structured data. Formula cells render as useful values. When a script adds a row, values like
        notes, tags, arrays, dates, and formulas are converted to readable Markdown.
      </p>
      <Snippet title="Table with formulas" code={tableSnippet} />
      <MiniGrid>
        <MiniCard title="Rows">
          <InlineCode>current.table("ideas")?.rows</InlineCode> returns one object per row.
        </MiniCard>
        <MiniCard title="Append">
          <InlineCode>await current.table("ideas")?.add(title, note, "new")</InlineCode>
        </MiniCard>
      </MiniGrid>
    </Section>

    <Section title="Lists, todos, data, and sections" icon="ti-components">
      <p>
        Use lists for simple ordered data, todos for checkboxes, data blocks for key-value facts, and sections for larger Markdown text. All
        use the same <InlineCode>@ref</InlineCode> idea.
      </p>
      <Snippet title="Four named block types" code={blocksSnippet} />
      <Warning>
        If the same ref exists more than once, read helpers return the first match for singular calls and all matches for plural calls.
        Write helpers on top-level refs update every matching block in the current note.
      </Warning>
    </Section>

    <Section title="Formulas" icon="ti-calculator">
      <p>Formula cells are still plain text. That keeps tables portable, but the editor and script tables can render them nicely.</p>
      <MiniGrid>
        <MiniCard title="Progress">
          <InlineCode>=PROGRESS(0.4)</InlineCode> or <InlineCode>=PROGRESS(2,10)</InlineCode>
        </MiniCard>
        <MiniCard title="Sum">
          <InlineCode>=SUM(Hours)</InlineCode> sums numeric cells in the named column. The formula cell itself is ignored.
        </MiniCard>
      </MiniGrid>
    </Section>

    <Section title="Script dashboards" icon="ti-code">
      <p>
        A script block runs in the note and renders output below the source. Use it for dashboards, buttons, forms, charts, and small
        workflows.
      </p>
      <Snippet title="Read current-note blocks" code={dashboardSnippet} language="script" />
      <Snippet title="Search notes and render a table" code={searchSnippet} language="script" />
    </Section>

    <Section title="Create and update" icon="ti-pencil-plus">
      <p>
        Scripts can create notes and update the current note. They can only write current-note content safely; other-note body writes are
        intentionally not exposed because collaboration happens through the open note.
      </p>
      <Snippet title="Create a linked note and append a table row" code={createSnippet} language="script" />
    </Section>

    <Section title="Charts and personal state" icon="ti-chart-bar">
      <p>Use charts for summaries and trends. Use local state for personal UI state, such as collapsed panels or a private counter.</p>
      <Snippet title="Render a chart" code={chartSnippet} language="script" />
      <Snippet title="Personal local state" code={stateSnippet} language="script" />
    </Section>
  </div>
);

const promptFormSnippet =
  '```script\nconst values = await ui.prompt.form({\n  title: "Add plant",\n  submitText: "Add",\n  fields: {\n    name: {\n      type: "text",\n      label: "Plant name",\n      required: true,\n      placeholder: "Tomato",\n    },\n    notes: {\n      type: "textarea",\n      label: "Notes",\n      rows: 3,\n    },\n    count: {\n      type: "number",\n      label: "Seedlings",\n      min: 0,\n      defaultValue: 1,\n    },\n    perennial: {\n      type: "boolean",\n      label: "Perennial plant",\n      defaultValue: false,\n    },\n    status: {\n      type: "select",\n      label: "Status",\n      options: ["planned", "sown", "planted", "harvested"],\n      defaultValue: "planned",\n    },\n  },\n});\n\nif (!values) return; // user cancelled\nawait current.table("plants")?.add(values.name, values.status, values.count, values.notes);\nui.toast("Plant added", { variant: "success" });\n```';

const uiTableExample =
  '```script\nconst notes = await nb.search("#garden");\n\nui.table(notes.map((note) => ({\n  note,\n  tags: note.tags,\n  tasks: note.todos().flatMap((list) => list.items).filter((todo) => !todo.done).length,\n  created: note.createdAt,\n}))).show();\n```';

const nbUpdateExample =
  '```script\nconst archived = await nb.search("#archive-candidate");\n\nif (archived.length === 0) {\n  ui.toast("No archive candidates found");\n  return;\n}\n\nconst ok = await ui.prompt.confirm(`Rename ${archived.length} note(s) as archived?`);\nif (!ok) return;\n\nfor (const note of archived) {\n  if (!note.title.startsWith("Archived: ")) {\n    await nb.update(note.id, { title: "Archived: " + note.title });\n  }\n}\n\nui.toast("Archive titles updated", { variant: "success" });\n```';

const localKVExample =
  '```script\nconst slot = ui.col();\nslot.show();\n\nconst render = async () => {\n  const clicks = (await nb.localKV.get("clicks")) ?? 0;\n  slot.replaceChildren(\n    ui.row(\n      ui.text(`Personal clicks: ${clicks}`),\n      ui.button("+1", async () => {\n        await nb.localKV.set("clicks", (current = 0) => current + 1);\n        await render();\n      }),\n    ),\n  );\n};\n\nawait render();\n```';

const collabStateExample =
  '```script\nconst slot = ui.col();\nslot.show();\n\nconst render = () => {\n  const value = current.kv.get("counter") ?? 0;\n  slot.replaceChildren(\n    ui.row(\n      ui.text(`Shared counter: ${value}`),\n      ui.button("+1", () => current.kv.set("counter", (current = 0) => current + 1)),\n      ui.button("Reset", () => current.kv.delete("counter")),\n    ),\n  );\n};\n\nrender();\ncurrent.kv.observe("counter", render);\n```';

const tagsExample =
  '```script\nconst all = await nb.tags.list();\n\nui.table(all.map((tag) => ({\n  tag: "#" + tag.tag,\n  notes: tag.count,\n}))).show();\n```';

const ApiTab = () => (
  <div class="space-y-5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
    <p>
      Script blocks expose four main namespaces: <InlineCode>current</InlineCode>, <InlineCode>nb</InlineCode>, <InlineCode>ui</InlineCode>,
      and <InlineCode>std</InlineCode>. You do not import anything. Type a namespace and a dot to use autocomplete.
    </p>
    <Info>
      Normal JavaScript globals are available too: <InlineCode>Date</InlineCode>, <InlineCode>Math</InlineCode>,{" "}
      <InlineCode>JSON</InlineCode>, <InlineCode>Array</InlineCode>, <InlineCode>Promise</InlineCode>, <InlineCode>console</InlineCode>, and
      the usual language features.
    </Info>

    <Section title="Rules before the reference" icon="ti-info-circle">
      <MiniGrid>
        <MiniCard title="Sync vs async">
          Reading current-note data is usually sync. Calls that touch storage, files, or notes outside the current content usually use{" "}
          <InlineCode>await</InlineCode>.
        </MiniCard>
        <MiniCard title="Missing data">
          Single reads return <InlineCode>null</InlineCode> when nothing matches. Many reads return an empty array.
        </MiniCard>
        <MiniCard title="Cancel">
          Prompt calls return <InlineCode>null</InlineCode> when the user cancels. Always handle that before writing data.
        </MiniCard>
        <MiniCard title="Scope">Scripts only see the current notebook. Note and attachment ids are short ids.</MiniCard>
      </MiniGrid>
    </Section>

    <Section title="Quick map" icon="ti-api">
      <MiniGrid>
        <MiniCard title="current">Read and update the note that contains the script.</MiniCard>
        <MiniCard title="nb">Search, create, update, and remove notes in the current notebook.</MiniCard>
        <MiniCard title="ui">Render output: text, tables, charts, buttons, prompts, cards, and toasts.</MiniCard>
        <MiniCard title="std">
          Curated standard-library helpers: text, dates, fuzzy search, crypto, charts, QR, files, images, timing.
        </MiniCard>
      </MiniGrid>
      <Info>
        Notebook helpers live under their owners: <InlineCode>current.kv</InlineCode>, <InlineCode>nb.localKV</InlineCode>,{" "}
        <InlineCode>nb.attachments</InlineCode>, and <InlineCode>nb.tags</InlineCode>.
      </Info>
    </Section>

    <Section title="Function index" icon="ti-list-search">
      <MiniGrid>
        <MiniCard title="Current note">
          current.id, current.title, current.content, current.tags, current.setTitle, current.appendContent
        </MiniCard>
        <MiniCard title="Named blocks">current.table(s), current.list(s), current.todo(s), current.dataBlocks, current.section(s)</MiniCard>
        <MiniCard title="Notebook notes">nb.list, nb.get, nb.search, nb.searchTags, nb.create, nb.update, nb.remove</MiniCard>
        <MiniCard title="UI output">ui.text, ui.heading, ui.md, ui.table, ui.chart, ui.noteLink, ui.noteList, ui.button, ui.toast</MiniCard>
        <MiniCard title="Prompts">ui.prompt.alert, ui.prompt.confirm, ui.prompt.text, ui.prompt.form</MiniCard>
        <MiniCard title="Notebook helpers">current.kv, nb.localKV, nb.attachments, nb.tags, std</MiniCard>
      </MiniGrid>
    </Section>

    <Section title="current note" icon="ti-note">
      <p>
        <InlineCode>current</InlineCode> is the note that contains the script. Metadata reads are sync. Content writes are async and only
        affect this note.
      </p>
      <ApiCardGrid>
        <ApiMethod
          name="Metadata fields"
          signature="current.id / title / content / tags / notebook / createdAt / updatedAt / lockedAt"
          returns="plain values"
        >
          <p>
            <InlineCode>id</InlineCode> is the short id. <InlineCode>tags</InlineCode> are strings without <InlineCode>#</InlineCode>.{" "}
            <InlineCode>notebook</InlineCode> contains the current notebook id and name.
          </p>
        </ApiMethod>
        <ApiMethod name="Content writes" signature="await current.setContent(markdown)" returns="void">
          <p>
            Also available: <InlineCode>setTitle</InlineCode>, <InlineCode>appendContent</InlineCode>,{" "}
            <InlineCode>prependContent</InlineCode>, <InlineCode>insertContentAt</InlineCode>, and <InlineCode>replaceLine</InlineCode>.
          </p>
        </ApiMethod>
      </ApiCardGrid>
      <Snippet
        title="Current note basics"
        language="script"
        code={
          '```script\nui.heading(current.title, 2).show();\nui.text(`Tags: ${current.tags.join(", ") || "none"}`).show();\n\nawait current.appendContent("\\n## Log\\nUpdated from script.\\n");\n```'
        }
      />
    </Section>

    <Section title="Named block pattern" icon="ti-blockquote">
      <p>
        Put <InlineCode>@ref</InlineCode> above a table, list, todo list, data block, or section. Singular reads return the first match or{" "}
        <InlineCode>null</InlineCode>. Plural reads return all matches; without a name they return every block of that type.
      </p>
      <div class="overflow-x-auto rounded-lg bg-zinc-50 p-2 text-xs dark:bg-zinc-900/60">
        <table class="w-full min-w-[42rem] table-fixed border-separate border-spacing-1">
          <thead>
            <tr class="text-left text-zinc-500 dark:text-zinc-400">
              <th class="p-2">Type</th>
              <th class="p-2">Read one</th>
              <th class="p-2">Read many</th>
              <th class="p-2">Write helper</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="p-2">table</td>
              <td class="p-2">
                <InlineCode>current.table("x")</InlineCode>
              </td>
              <td class="p-2">
                <InlineCode>current.tables("x")</InlineCode>
              </td>
              <td class="p-2">
                <InlineCode>table.add(...cells)</InlineCode>
              </td>
            </tr>
            <tr>
              <td class="p-2">list</td>
              <td class="p-2">
                <InlineCode>current.list("x")</InlineCode>
              </td>
              <td class="p-2">
                <InlineCode>current.lists("x")</InlineCode>
              </td>
              <td class="p-2">
                <InlineCode>list.add(...items)</InlineCode>
              </td>
            </tr>
            <tr>
              <td class="p-2">todo</td>
              <td class="p-2">
                <InlineCode>current.todo("x")</InlineCode>
              </td>
              <td class="p-2">
                <InlineCode>current.todos("x")</InlineCode>
              </td>
              <td class="p-2">
                <InlineCode>todo.add(...items)</InlineCode>
              </td>
            </tr>
            <tr>
              <td class="p-2">data</td>
              <td class="p-2">
                <InlineCode>current.data("x")</InlineCode>
              </td>
              <td class="p-2">
                <InlineCode>current.dataBlocks("x")</InlineCode>
              </td>
              <td class="p-2">
                <InlineCode>data.set(object)</InlineCode>
              </td>
            </tr>
            <tr>
              <td class="p-2">section</td>
              <td class="p-2">
                <InlineCode>current.section("x")</InlineCode>
              </td>
              <td class="p-2">
                <InlineCode>current.sections("x")</InlineCode>
              </td>
              <td class="p-2">
                <InlineCode>section.append(markdown)</InlineCode>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Section>

    <Section title="Tables" icon="ti-table">
      <ApiCardGrid>
        <ApiMethod name="Read one table" signature="current.table(name)" returns="table object or null">
          <p>
            The table object has <InlineCode>columns</InlineCode>, <InlineCode>rows</InlineCode>, and <InlineCode>add</InlineCode>. Each row
            is an object keyed by the Markdown table headers.
          </p>
        </ApiMethod>
        <ApiMethod name="Read many tables" signature="current.tables(name?)" returns="table object[]">
          <p>Pass a name to get all matching refs. Omit the name to read all tables in the current note.</p>
        </ApiMethod>
        <ApiMethod name="Append row" signature="await table.add(...cells)" returns="void">
          <p>
            Accepts varargs, one array, or one object keyed by column names. Notes become note links, arrays are joined, formulas stay as
            formulas.
          </p>
        </ApiMethod>
      </ApiCardGrid>
      <Snippet title="Read and append a named table" code={createSnippet} language="script" />
    </Section>

    <Section title="Lists, todos, data, and sections" icon="ti-components">
      <ApiCardGrid>
        <ApiMethod name="Lists" signature="current.list(name), current.lists(name?)" returns="{ items, add } or array">
          <p>
            Plain list items are strings. Use <InlineCode>await list.add("milk", "eggs")</InlineCode> to append items.
          </p>
        </ApiMethod>
        <ApiMethod name="Todos" signature="current.todo(name), current.todos(name?)" returns="{ items, add } or array">
          <p>
            Todo items are <InlineCode>{"{ done, content, line }"}</InlineCode>. The line number is read-only and best-effort.
          </p>
        </ApiMethod>
        <ApiMethod name="Data blocks" signature="current.data(name), current.dataBlocks(name?)" returns="{ value, set } or array">
          <p>
            Reads <InlineCode>:::data</InlineCode> blocks as objects. Use <InlineCode>await data.set(object)</InlineCode> to replace the
            block.
          </p>
        </ApiMethod>
        <ApiMethod name="Sections" signature="current.section(name), current.sections(name?)" returns="{ markdown, append } or array">
          <p>
            Reads a heading section marked by <InlineCode>@ref</InlineCode>. Use <InlineCode>append(markdown)</InlineCode> for logs and
            notes.
          </p>
        </ApiMethod>
      </ApiCardGrid>
      <Snippet title="Read several block types" code={dashboardSnippet} language="script" />
    </Section>

    <Section title="nb notes" icon="ti-notebook">
      <p>
        <InlineCode>nb</InlineCode> works with notes in the current notebook. These calls are async because they go through the app API.
      </p>
      <ApiCardGrid>
        <ApiMethod name="List and fetch" signature="await nb.list(), await nb.get(shortId)" returns="note[] or note | null">
          <p>
            <InlineCode>get</InlineCode> returns <InlineCode>null</InlineCode> for missing ids.
          </p>
        </ApiMethod>
        <ApiMethod name="Search" signature="await nb.search(query), await nb.searchTags(tags, options?)" returns="note[]">
          <p>
            Search by text, <InlineCode>#tag</InlineCode>, or a structured filter object such as{" "}
            <InlineCode>{'{ tags: ["garden"], limit: 20 }'}</InlineCode>.
          </p>
        </ApiMethod>
        <ApiMethod name="Create" signature="await nb.create({ title, parentId?, content? })" returns="created note">
          <p>
            <InlineCode>parentId</InlineCode> is a note short id. The new note belongs to the current notebook.
          </p>
        </ApiMethod>
        <ApiMethod
          name="Update and remove"
          signature="await nb.update(shortId, patch), await nb.remove(shortId)"
          returns="updated note or void"
        >
          <p>Update note metadata such as title or parent. Body writes for other notes are intentionally not exposed.</p>
        </ApiMethod>
      </ApiCardGrid>
      <Snippet title="Search notes and render a table" code={uiTableExample} language="script" />
      <Snippet title="Bulk-update note metadata" code={nbUpdateExample} language="script" />
    </Section>

    <Section title="ui output" icon="ti-layout-dashboard">
      <ApiCardGrid>
        <ApiMethod name="Layout primitives" signature="ui.row, ui.col, ui.card, ui.divider" returns="UI element">
          <p>
            Compose these with text, headings, tables, buttons, and charts. Call <InlineCode>.show()</InlineCode> on the root element.
          </p>
        </ApiMethod>
        <ApiMethod name="Text and Markdown" signature="ui.text, ui.heading, ui.md" returns="UI element">
          <p>
            <InlineCode>ui.md</InlineCode> renders Markdown with the same engine as notebook content.
          </p>
        </ApiMethod>
        <ApiMethod name="Notes and tables" signature="ui.noteLink, ui.noteList, ui.table" returns="UI element">
          <p>Tables understand note objects, tags, ISO dates, formulas, progress values, arrays, and plain objects.</p>
        </ApiMethod>
        <ApiMethod name="Actions and feedback" signature="ui.button, ui.toast, ui.render" returns="UI element or void">
          <p>
            Buttons may run async handlers. Toast options include <InlineCode>variant</InlineCode>, <InlineCode>duration</InlineCode>,{" "}
            <InlineCode>iconClass</InlineCode>, and <InlineCode>title</InlineCode>.
          </p>
        </ApiMethod>
      </ApiCardGrid>
      <Snippet title="Pretty table output" code={uiTableExample} language="script" />
      <Snippet title="Chart output" code={chartSnippet} language="script" />
    </Section>

    <Section title="ui.prompt" icon="ti-forms">
      <p>
        Prompt calls open modal dialogs. <InlineCode>alert</InlineCode> returns when the user closes it. <InlineCode>confirm</InlineCode>{" "}
        returns a boolean. <InlineCode>text</InlineCode> and <InlineCode>form</InlineCode> return <InlineCode>null</InlineCode> when
        cancelled.
      </p>
      <ApiCardGrid>
        <ApiMethod name="Simple prompts" signature="await ui.prompt.alert/confirm/text(...)" returns="void, boolean, or string | null">
          <p>
            Use these for one decision or one text value. Always check <InlineCode>null</InlineCode> before writing.
          </p>
        </ApiMethod>
        <ApiMethod name="Forms" signature="await ui.prompt.form(spec)" returns="object | null">
          <p>
            Field types include <InlineCode>text</InlineCode>, <InlineCode>textarea</InlineCode>, <InlineCode>number</InlineCode>,{" "}
            <InlineCode>boolean</InlineCode>, and <InlineCode>select</InlineCode>.
          </p>
        </ApiMethod>
      </ApiCardGrid>
      <Snippet title="Full form example" code={promptFormSnippet} language="script" />
    </Section>

    <Section title="current.kv and nb.localKV" icon="ti-database">
      <MiniGrid>
        <MiniCard title="current.kv">Collaborative per-note state. Use it when everyone should see the same value.</MiniCard>
        <MiniCard title="nb.localKV">Private per-user, per-notebook state. Use it for personal UI state and preferences.</MiniCard>
      </MiniGrid>
      <Snippet title="Collaborative current.kv with observe" code={collabStateExample} language="script" />
      <Snippet title="Personal local KV" code={localKVExample} language="script" />
    </Section>

    <Section title="nb.attachments, nb.tags, and std" icon="ti-tool">
      <ApiCardGrid>
        <ApiMethod
          name="nb.attachments"
          signature="await nb.attachments.list/upload/uploadFromPicker/get/remove(...)"
          returns="attachment data"
        >
          <p>
            Use <InlineCode>insertIntoContent(shortId)</InlineCode> to append an attachment link or image embed to the current note.
          </p>
        </ApiMethod>
        <ApiMethod name="nb.tags" signature="await nb.tags.list(), await nb.tags.notesForTag(tag)" returns="tag counts or notes">
          <p>
            Tags are scoped to the current notebook. Pass tags with or without <InlineCode>#</InlineCode>.
          </p>
        </ApiMethod>
        <ApiMethod name="std" signature="std.text, std.dates, std.fuzzy, std.crypto, std.charts, ..." returns="utility namespaces">
          <p>Use stdlib helpers for formatting, dates, fuzzy search, charts, QR codes, files, images, clipboard, passwords, and timing.</p>
        </ApiMethod>
      </ApiCardGrid>
      <Snippet title="Pick images and insert them into the current note" code={attachmentsSnippet} language="script" />
      <Snippet title="List notebook tags" code={tagsExample} language="script" />
    </Section>
  </div>
);

export default function NotebookLayoutHelp() {
  return (
    <>
      <Layout.Help
        id="notebooks-overview"
        title="Notebooks: Basics"
        icon="ti ti-markdown"
        description="A practical start for notes, Markdown, links, and small notebook apps."
        order={100}
      >
        <OverviewTab />
      </Layout.Help>
      <Layout.Help
        id="notebooks-advanced"
        title="Advanced Blocks"
        icon="ti ti-components"
        description="Named blocks, tables, data blocks, formulas, scripts, charts, and workflows."
        order={110}
      >
        <AdvancedTab />
      </Layout.Help>
      <Layout.Help
        id="notebooks-script-api"
        title="Script API"
        icon="ti ti-code"
        description="Readable reference for current, nb, ui, std, current.kv, nb.attachments, nb.tags, and nb.localKV."
        order={120}
      >
        <ApiTab />
      </Layout.Help>
    </>
  );
}
