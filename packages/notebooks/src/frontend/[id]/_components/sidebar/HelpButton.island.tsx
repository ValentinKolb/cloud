/**
 * Sidebar Help entry. Click opens a large prompts.dialog with a
 * scrollable cheat-sheet covering everything a user needs to work
 * with notebooks — from markdown basics through to scripting (with
 * its security warning).
 *
 * Content lives inline as JSX so it can use Tailwind for visual
 * hierarchy without spinning up the markdown renderer just to
 * display static help. Where it matters, rendered examples sit
 * next to the syntax (the green tag pill, the colored callouts,
 * the kbd-style keys) so the user sees what they'll get.
 *
 * Visual variety carries meaning, not decoration:
 *
 *   - Section icons are coloured by topic so the eye groups
 *     features at a glance (math = purple, scripting = red, etc.)
 *   - Tag examples render as actual pills (matches the editor).
 *   - Callout examples render as actual callouts.
 *   - Keyboard keys render with kbd-style border + shadow.
 *   - Inline code stays neutral for plain syntax.
 *
 * Writing style: short sentences, plain English, no filler. Each
 * section answers one question; examples come right after the rule
 * they illustrate.
 *
 * All facts in this file were verified against the actual code
 * (formula evaluator, slash commands, regexes, kit API surface)
 * during the rewrite — keep that bar if you edit.
 */
import { prompts } from "@valentinkolb/cloud/ui";
import type { JSX } from "solid-js";

// =============================================================================
// Visual building blocks
// =============================================================================

type Tone = "zinc" | "blue" | "emerald" | "violet" | "amber" | "purple" | "rose" | "red" | "sky";

const TONE_ICON: Record<Tone, string> = {
  zinc: "text-zinc-500 dark:text-zinc-400",
  blue: "text-blue-600 dark:text-blue-400",
  emerald: "text-emerald-600 dark:text-emerald-400",
  violet: "text-violet-600 dark:text-violet-400",
  amber: "text-amber-600 dark:text-amber-400",
  purple: "text-purple-600 dark:text-purple-400",
  rose: "text-rose-600 dark:text-rose-400",
  red: "text-red-600 dark:text-red-400",
  sky: "text-sky-600 dark:text-sky-400",
};

/** Section heading with topic-coloured icon. The colour only lives
 *  on the icon — the text stays neutral so the visual rhythm doesn't
 *  fight the content. `first` removes the top margin for the lead
 *  section (kills the gap between the dialog header and the body). */
const H = (props: { children: JSX.Element; icon: string; tone: Tone; first?: boolean }) => (
  <h2 class={`flex items-center gap-2 text-sm font-semibold text-primary mb-2 ${props.first ? "" : "mt-7"}`}>
    <i class={`ti ${props.icon} text-base ${TONE_ICON[props.tone]}`} />
    {props.children}
  </h2>
);

/** Inline code for syntax / literal characters. Neutral. */
const C = (props: { children: JSX.Element }) => (
  <code class="rounded bg-zinc-100 dark:bg-zinc-800 px-1 py-px text-[11px] font-mono text-zinc-800 dark:text-zinc-200">
    {props.children}
  </code>
);

/** Keyboard key cap. Used in the shortcuts section so keys read as
 *  physical keys, not as syntax. */
const Key = (props: { children: JSX.Element }) => (
  <kbd class="inline-flex items-center rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 px-1.5 py-0.5 text-[10px] font-mono text-zinc-700 dark:text-zinc-300 shadow-[0_1px_0_rgba(0,0,0,0.05)] dark:shadow-[0_1px_0_rgba(255,255,255,0.04)]">
    {props.children}
  </kbd>
);

/** Render an actual tag pill — same look as the editor pill so the
 *  user sees what their tag will look like. */
const TagPill = (props: { name: string }) => (
  <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300">
    #{props.name}
  </span>
);

/** Code / multiline example block. */
const Code = (props: { children: JSX.Element }) => (
  <pre class="my-2 rounded bg-zinc-100 dark:bg-zinc-900 px-3 py-2 text-[12px] leading-relaxed font-mono whitespace-pre-wrap text-zinc-800 dark:text-zinc-200 overflow-x-auto">
    {props.children}
  </pre>
);

/** Two-column reference table — left column is the trigger / syntax,
 *  right column is the meaning. */
const RefTable = (props: { rows: { left: JSX.Element; right: JSX.Element }[] }) => (
  <table class="my-2 w-full text-[12px]">
    <tbody>
      {props.rows.map((r) => (
        <tr class="border-b border-zinc-100 dark:border-zinc-800 last:border-0">
          <td class="py-1 pr-4 align-top whitespace-nowrap">{r.left}</td>
          <td class="py-1 align-top text-zinc-600 dark:text-zinc-400">{r.right}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

/** Generic callout. Variants pick their own colour so the user sees
 *  exactly what each `:::variant` block renders as. Used both for
 *  the editorial "warning" at the top of the scripting section AND
 *  inline as live examples in the callouts section. */
const Callout = (props: {
  variant: "info" | "warning" | "success" | "danger" | "note";
  title?: string;
  children: JSX.Element;
}) => {
  const styles: Record<typeof props.variant, string> = {
    info: "border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200",
    warning: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
    success: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
    danger: "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200",
    note: "border-zinc-300 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-300",
  };
  const icons: Record<typeof props.variant, string> = {
    info: "ti-info-circle",
    warning: "ti-alert-triangle",
    success: "ti-check",
    danger: "ti-alert-octagon",
    note: "ti-chevron-right",
  };
  return (
    <div class={`my-3 flex gap-3 rounded border px-3 py-2 text-[12px] leading-relaxed ${styles[props.variant]}`}>
      <i class={`ti ${icons[props.variant]} mt-0.5 shrink-0 text-sm`} />
      <div class="flex-1 space-y-1">
        {props.title && <p class="font-semibold">{props.title}</p>}
        {props.children}
      </div>
    </div>
  );
};

// =============================================================================
// Modal body
// =============================================================================

const HelpModalBody = () => (
  <div class="w-full max-w-full flex flex-col text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-300 min-w-[28rem]">
    {/* --- Lead: no header, just the pitch --- */}
    <p>
      A notebook app. Write notes in markdown, organize them into notebooks, search across everything, and — if you turn it on — run small scripts inside notes.
    </p>
    <ul class="mt-2 ml-4 list-disc space-y-1">
      <li>Notes live in notebooks. Notebooks can be private or shared.</li>
      <li>Notes save automatically. Other people see your edits live.</li>
      <li>Everything is just markdown — your notes are portable.</li>
    </ul>

    {/* --- Markdown basics --- */}
    <H icon="ti-markdown" tone="zinc">Markdown basics</H>
    <p>Markdown is plain text with a few symbols that turn into formatting.</p>
    <RefTable
      rows={[
        { left: <C>**bold**</C>, right: <strong>bold</strong> },
        { left: <C>_italic_</C>, right: <em>italic</em> },
        { left: <C># Heading</C>, right: <span>large heading (1 to 6 #s)</span> },
        { left: <C>- item</C>, right: <span>bullet list</span> },
        { left: <C>1. item</C>, right: <span>numbered list</span> },
        { left: <C>- [ ] task</C>, right: <span>checkbox</span> },
        { left: <C>&gt; quote</C>, right: <span>quote block</span> },
        { left: <C>`code`</C>, right: <code class="font-mono">inline code</code> },
        { left: <C>[label](url)</C>, right: <span>link</span> },
        { left: <C>---</C>, right: <span>horizontal rule</span> },
      ]}
    />
    <p class="text-[12px] text-zinc-500 dark:text-zinc-400">
      The editor renders these live. You always see the raw markdown when your cursor sits inside it — move away and it renders.
    </p>

    {/* --- Slash commands --- */}
    <H icon="ti-slash" tone="blue">Slash commands</H>
    <p>
      Type <C>/</C> on an empty line to open the command menu. Pick one to insert. There are a lot; the menu is filterable.
    </p>
    <RefTable
      rows={[
        { left: <C>/h1</C>, right: <span>heading (1–6 work: <C>/h1</C> … <C>/h6</C>)</span> },
        { left: <C>/list</C>, right: <span>bullet list — also <C>/numbered</C>, <C>/todo</C></span> },
        { left: <C>/quote</C>, right: <span>quote — also <C>/divider</C> for a horizontal rule</span> },
        { left: <C>/code</C>, right: <span>code fence — also <C>/js</C> <C>/py</C> <C>/sql</C> <C>/json</C> <C>/bash</C> as shortcuts</span> },
        { left: <C>/table</C>, right: <span>table</span> },
        { left: <C>/math</C>, right: <span>block math (KaTeX)</span> },
        { left: <C>/mermaid</C>, right: <span>diagram</span> },
        { left: <C>/info</C>, right: <span>callout — also <C>/warning</C> <C>/success</C> <C>/danger</C> <C>/callout</C></span> },
        { left: <C>/link</C>, right: <span>regular markdown link</span> },
        { left: <C>/note</C>, right: <span>open the note picker (same as typing <C>[[</C>)</span> },
        { left: <C>/file</C>, right: <span>insert reference to an existing attachment</span> },
        { left: <C>/upload</C>, right: <span>upload a new file</span> },
        { left: <C>/tag</C>, right: <span>open the tag picker</span> },
        { left: <C>/script</C>, right: <span>script block (requires scripts enabled, see below)</span> },
        { left: <C>/now</C>, right: <span>insert date+time — also <C>/date</C> <C>/time</C> <C>/tomorrow</C> <C>/yesterday</C></span> },
        { left: <C>/uuid</C>, right: <span>insert a UUID — <C>/id</C> for a short readable id, <C>/lorem</C> for placeholder text</span> },
      ]}
    />

    {/* --- Tags --- */}
    <H icon="ti-hash" tone="emerald">Tags</H>
    <p>
      Tags group related notes. Type <C>#name</C> anywhere. The tag renders as a green pill and shows up in the sidebar Tags list.
    </p>
    <p class="my-2">
      Example: <span>Meeting notes for project Apollo. <TagPill name="project/apollo" /> <TagPill name="meeting" /></span>
    </p>
    <ul class="ml-4 list-disc space-y-1">
      <li>Tags start with a letter, then letters, digits, <C>-</C>, <C>_</C>, or <C>/</C>.</li>
      <li>Use <C>/</C> for nested tags: <TagPill name="project/apollo" /> lives under <TagPill name="project" />.</li>
      <li><C>#1abc</C> and <C>##heading</C> are not tags (digit / hash start).</li>
      <li>Tags inside code blocks are ignored.</li>
      <li>Click any pill to see all notes with that tag.</li>
    </ul>

    {/* --- Links + attachments --- */}
    <H icon="ti-link" tone="violet">Note links and attachments</H>
    <p>
      Type <C>[[</C> to link to another note. A picker opens with notes from this notebook. Pick one — the link uses the note's title and survives renames.
    </p>
    <p>
      Type <C>![[</C> to embed a file. Images render inline. Other files render as a download pill.
    </p>
    <p>Drag files onto the editor or paste from the clipboard. Screenshots work.</p>
    <Callout variant="info">
      <p>Images over 10 MB get auto-resized to fit. The original is not stored — what you see is what gets saved.</p>
    </Callout>

    {/* --- Tables + formulas --- */}
    <H icon="ti-table" tone="amber">Tables and formulas</H>
    <p>
      Insert with <C>/table</C>. Edit cells inline; the toolbar adds rows and columns.
    </p>
    <p>
      Any cell can be a formula. Start with <C>=</C> and reference other columns by their <strong>header name</strong> (case-insensitive). Example given a table with columns <C>price</C>, <C>qty</C>, <C>total</C>:
    </p>
    <Code>{`=price * qty            in the total column
=SUM(price)             total of the price column
=AVG(rating)            average of the rating column
=ROUND(SUM(total), 2)   round to 2 decimals
=IF(qty > 10, "bulk", "single")`}</Code>
    <p>Functions, grouped by kind:</p>
    <RefTable
      rows={[
        { left: <span>Math</span>, right: <span><C>ROUND</C> <C>ABS</C> <C>SQRT</C> <C>POW</C> <C>MOD</C></span> },
        { left: <span>Aggregates (column)</span>, right: <span><C>SUM</C> <C>AVG</C> <C>MIN</C> <C>MAX</C> <C>COUNT</C> <C>MEDIAN</C> <C>UNIQUE</C> <C>STDEV</C> <C>COUNTIF</C> <C>SUMIF</C> <C>PERCENT</C></span> },
        { left: <span>Aggregates (row)</span>, right: <span><C>ROWSUM</C> <C>ROWAVG</C></span> },
        { left: <span>Conditional</span>, right: <span><C>IF</C> <C>IFEMPTY</C> <C>IFERROR</C></span> },
        { left: <span>Logical</span>, right: <span><C>AND</C> <C>OR</C> <C>NOT</C> <C>CONTAINS</C></span> },
        { left: <span>String</span>, right: <span><C>CONCAT</C> <C>UPPER</C> <C>LOWER</C> <C>LEN</C> <C>TRIM</C> <C>LEFT</C> <C>RIGHT</C> <C>SUBSTRING</C> <C>REPLACE</C></span> },
        { left: <span>Date</span>, right: <span><C>NOW</C> <C>TODAY</C> <C>DATEDIFF</C></span> },
      ]}
    />
    <p class="text-[12px] text-zinc-500 dark:text-zinc-400">
      Formulas can reference other formula cells. The engine detects cycles and shows an error if you build one.
    </p>

    {/* --- Math + diagrams --- */}
    <H icon="ti-math-function" tone="purple">Math and diagrams</H>
    <p>
      Inline math uses single dollars: <C>$x^2 + y^2 = z^2$</C>. Block math uses double dollars on their own lines.
    </p>
    <Code>{`$$
\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}
$$`}</Code>
    <p>
      Mermaid diagrams use a <C>mermaid</C> code fence:
    </p>
    <Code>{`\`\`\`mermaid
graph TD
  A[Start] --> B{Decision}
  B -->|yes| C[Do it]
  B -->|no| D[Skip]
\`\`\``}</Code>
    <p class="text-[12px] text-zinc-500 dark:text-zinc-400">
      Both render live. Click a rendered widget to edit the source.
    </p>

    {/* --- Callouts --- */}
    <H icon="ti-alert-circle" tone="rose">Callout blocks</H>
    <p>For text that should stand out. Wrap with <C>:::variant</C> and <C>:::</C>:</p>
    <Code>{`:::info
Heads up.
:::`}</Code>
    <p>Five variants — each gets its own colour:</p>
    <Callout variant="info"><p><C>:::info</C> — neutral attention</p></Callout>
    <Callout variant="success"><p><C>:::success</C> — good news</p></Callout>
    <Callout variant="warning"><p><C>:::warning</C> — caution</p></Callout>
    <Callout variant="danger"><p><C>:::danger</C> — serious problem</p></Callout>
    <Callout variant="note"><p><C>:::note</C> — sidebar remark</p></Callout>

    {/* --- Scripting --- */}
    <H icon="ti-code" tone="red">Scripting</H>
    <Callout variant="danger" title="Scripts run JavaScript in your browser.">
      <p>Only enable for notebooks you trust. A malicious script in a shared notebook can:</p>
      <ul class="ml-4 list-disc">
        <li>read every note in this notebook</li>
        <li>upload files to this notebook as you</li>
        <li>call APIs with your session</li>
      </ul>
      <p>Turn scripts off in the notebook settings if unsure.</p>
    </Callout>
    <p>
      To enable: open the notebook settings (cog icon, top of sidebar) and toggle Scripts on. Then write a code fence with language <C>script</C>:
    </p>
    <Code>{`\`\`\`script
const notes = await kit.notes.list();
return \`This notebook has \${notes.length} notes.\`;
\`\`\``}</Code>
    <p>The return value renders below the block. The <C>kit</C> object exposes:</p>
    <RefTable
      rows={[
        { left: <C>kit.note</C>, right: <span>current note — read fields, edit content</span> },
        { left: <C>kit.notes</C>, right: <span>list, search, create notes in this notebook</span> },
        { left: <C>kit.attachments</C>, right: <span>list, upload, fetch files</span> },
        { left: <C>kit.tags</C>, right: <span>tag index of this notebook</span> },
        { left: <C>kit.state</C>, right: <span>shared key-value store per note (collaborative)</span> },
        { left: <C>kit.localState</C>, right: <span>private key-value store per user (this browser)</span> },
        { left: <C>kit.ui</C>, right: <span>open prompts, show toasts</span> },
      ]}
    />
    <p class="text-[12px] text-zinc-500 dark:text-zinc-400">
      Also available: re-exports from the platform stdlib — <C>kit.text</C>, <C>kit.dates</C>, <C>kit.fuzzy</C>, <C>kit.crypto</C>. Your editor's autocomplete lists every method with its signature.
    </p>

    {/* --- Files & images --- */}
    <H icon="ti-paperclip" tone="sky">Files and images</H>
    <ul class="ml-4 list-disc space-y-1">
      <li>Drag files onto the editor, or paste from the clipboard (screenshots work).</li>
      <li>Images larger than 10 MB are auto-resized. A toast tells you the new size.</li>
      <li>Non-image files larger than 10 MB are rejected — pick a smaller file.</li>
      <li>All attachments live with the notebook. Open the Attachments view from the sidebar to manage them.</li>
      <li>Markdown links use <C>attach://shortId</C> so renames don't break references.</li>
    </ul>

    {/* --- Keyboard shortcuts --- */}
    <H icon="ti-keyboard" tone="zinc">Keyboard shortcuts</H>
    <p class="text-[12px] text-zinc-500 dark:text-zinc-400">
      <C>Mod</C> = <Key>⌘</Key> on Mac, <Key>Ctrl</Key> on Windows / Linux.
    </p>
    <RefTable
      rows={[
        { left: <span><Key>Mod</Key> + <Key>B</Key></span>, right: <span>bold</span> },
        { left: <span><Key>Mod</Key> + <Key>I</Key></span>, right: <span>italic</span> },
        { left: <span><Key>Mod</Key> + <Key>E</Key></span>, right: <span>inline code</span> },
        { left: <span><Key>Mod</Key> + <Key>K</Key></span>, right: <span>insert link</span> },
        { left: <span><Key>Mod</Key> + <Key>Alt</Key> + <Key>K</Key></span>, right: <span>insert link to another note</span> },
        { left: <span><Key>Mod</Key> + <Key>Shift</Key> + <Key>S</Key></span>, right: <span>strikethrough</span> },
        { left: <span><Key>Mod</Key> + <Key>Shift</Key> + <Key>H</Key></span>, right: <span>cycle heading level</span> },
        { left: <span><Key>Mod</Key> + <Key>Shift</Key> + <Key>K</Key></span>, right: <span>open global search</span> },
        { left: <Key>/</Key>, right: <span>open the slash-command menu</span> },
        { left: <Key>[[</Key>, right: <span>note-link picker</span> },
        { left: <Key>![[</Key>, right: <span>attachment picker</span> },
        { left: <Key>#</Key>, right: <span>insert / autocomplete a tag</span> },
      ]}
    />
  </div>
);

// =============================================================================
// Trigger
// =============================================================================

const openHelpModal = () =>
  prompts.dialog<void>((_close) => <HelpModalBody />, {
    title: "Help",
    icon: "ti ti-help",
    size: "large",
  });

type Variant = "sidebar" | "sidebar-mobile";

type Props = {
  variant: Variant;
};

export default function HelpButton(props: Props) {
  if (props.variant === "sidebar-mobile") {
    return (
      <button type="button" class="sidebar-item-mobile w-full" onClick={() => void openHelpModal()}>
        <i class="ti ti-help" />
        Help
      </button>
    );
  }
  return (
    <button
      type="button"
      class="sidebar-item text-xs w-full"
      onClick={() => void openHelpModal()}
      title="How this app works"
    >
      <i class="ti ti-help text-sm" />
      <span class="flex-1 text-left">Help</span>
    </button>
  );
}
