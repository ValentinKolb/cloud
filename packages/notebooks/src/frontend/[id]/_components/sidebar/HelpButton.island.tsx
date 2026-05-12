/**
 * Sidebar Help entry. Click opens a large prompts.dialog with a
 * scrollable cheat-sheet covering everything a user needs to use
 * notebooks productively — from "what is markdown" through to
 * scripting (with its security warning).
 *
 * Content lives inline as JSX so it can use Tailwind for visual
 * hierarchy without spinning up the markdown renderer just to
 * display static help. The trade-off: the help text can't be
 * authored in markdown itself. Acceptable — the audience is more
 * helped by polished JSX layout than by dogfood.
 *
 * Writing style: short sentences, plain English, no filler. Each
 * section answers one question. Examples come right after the rule
 * they illustrate.
 */
import { prompts } from "@valentinkolb/cloud/ui";
import type { JSX } from "solid-js";

// =============================================================================
// Building blocks
// =============================================================================

/** Section heading — same scale across the modal so the eye can
 *  scan section titles without re-anchoring on different font sizes. */
const H = (props: { children: JSX.Element; icon: string }) => (
  <h2 class="flex items-center gap-2 text-sm font-semibold text-primary mt-6 mb-2">
    <i class={`ti ${props.icon} text-base`} />
    {props.children}
  </h2>
);

/** Code / example block — slightly indented, monospace, dim background. */
const Code = (props: { children: JSX.Element }) => (
  <pre class="my-2 rounded bg-zinc-100 dark:bg-zinc-900 px-3 py-2 text-[12px] leading-relaxed font-mono whitespace-pre-wrap text-zinc-800 dark:text-zinc-200 overflow-x-auto">
    {props.children}
  </pre>
);

/** Inline code style. */
const Kbd = (props: { children: JSX.Element }) => (
  <code class="rounded bg-zinc-100 dark:bg-zinc-800 px-1 py-px text-[11px] font-mono text-zinc-700 dark:text-zinc-300">
    {props.children}
  </code>
);

/** Quick callout (warning / note). */
const Callout = (props: { variant: "warning" | "info"; children: JSX.Element }) => {
  const cls =
    props.variant === "warning"
      ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
      : "border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200";
  const icon = props.variant === "warning" ? "ti-alert-triangle" : "ti-info-circle";
  return (
    <div class={`my-3 flex gap-3 rounded border px-3 py-2 text-[12px] leading-relaxed ${cls}`}>
      <i class={`ti ${icon} mt-0.5 shrink-0 text-sm`} />
      <div class="space-y-1">{props.children}</div>
    </div>
  );
};

/** Two-column reference table (key | meaning). */
const RefTable = (props: { rows: { left: JSX.Element; right: JSX.Element }[] }) => (
  <table class="my-2 w-full text-[12px]">
    <tbody>
      {props.rows.map((r) => (
        <tr class="border-b border-zinc-100 dark:border-zinc-800 last:border-0">
          <td class="py-1 pr-4 align-top font-mono text-zinc-700 dark:text-zinc-300 whitespace-nowrap">{r.left}</td>
          <td class="py-1 align-top text-zinc-600 dark:text-zinc-400">{r.right}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

// =============================================================================
// Modal body
// =============================================================================

const HelpModalBody = () => (
  <div class="w-full max-w-full flex flex-col text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-300 min-w-[28rem]">
    {/* --- What this is --- */}
    <H icon="ti-sparkles">What is this?</H>
    <p>
      A notebook app. Write notes in markdown, organize them into notebooks, search across everything, and (if you turn it on) run small scripts inside notes.
    </p>
    <ul class="mt-2 ml-4 list-disc space-y-1">
      <li>Notes live in notebooks. Notebooks can be private or shared.</li>
      <li>Notes save automatically. Other people see your edits live.</li>
      <li>Everything is just markdown — your notes are portable.</li>
    </ul>

    {/* --- Markdown basics --- */}
    <H icon="ti-markdown">Markdown basics</H>
    <p>Markdown is plain text with a few symbols that turn into formatting.</p>
    <RefTable
      rows={[
        { left: <span>**bold**</span>, right: <strong>bold</strong> },
        { left: <span>_italic_</span>, right: <em>italic</em> },
        { left: <span># Heading</span>, right: <span>large heading (1 to 6 #s)</span> },
        { left: <span>- item</span>, right: <span>bullet list</span> },
        { left: <span>1. item</span>, right: <span>numbered list</span> },
        { left: <span>- [ ] task</span>, right: <span>checkbox task</span> },
        { left: <span>&gt; quote</span>, right: <span>indented quote</span> },
        { left: <span>`code`</span>, right: <span>inline code</span> },
        { left: <span>[label](url)</span>, right: <span>link</span> },
        { left: <span>---</span>, right: <span>horizontal rule</span> },
      ]}
    />
    <p class="text-[12px] text-dimmed">
      The editor renders these live. You always see the markdown when your cursor sits inside it — move away and it renders.
    </p>

    {/* --- Slash commands --- */}
    <H icon="ti-slash">Slash commands</H>
    <p>
      Type <Kbd>/</Kbd> on an empty line to open the command menu. Pick one to insert.
    </p>
    <RefTable
      rows={[
        { left: <span>/h1 /h2 /h3</span>, right: <span>headings</span> },
        { left: <span>/list /ordered /check</span>, right: <span>list, numbered list, task list</span> },
        { left: <span>/quote</span>, right: <span>quote block</span> },
        { left: <span>/code</span>, right: <span>code fence (pick language after)</span> },
        { left: <span>/table</span>, right: <span>table</span> },
        { left: <span>/math</span>, right: <span>block math</span> },
        { left: <span>/mermaid</span>, right: <span>diagram</span> },
        { left: <span>/info /warning /success /danger</span>, right: <span>colored callouts</span> },
        { left: <span>/file /tag</span>, right: <span>attachment / tag picker</span> },
        { left: <span>/script</span>, right: <span>script block (notebook must enable scripts)</span> },
      ]}
    />

    {/* --- Tags --- */}
    <H icon="ti-hash">Tags</H>
    <p>
      Tags group related notes. Type <Kbd>#tag</Kbd> anywhere. The tag renders as a green pill and shows up in the sidebar Tags list.
    </p>
    <Code>{`Meeting notes for project Apollo. #project/apollo #meeting`}</Code>
    <ul class="ml-4 list-disc space-y-1">
      <li>Tags start with a letter, then letters, digits, <Kbd>-</Kbd>, <Kbd>_</Kbd>, or <Kbd>/</Kbd>.</li>
      <li>Use <Kbd>/</Kbd> for nested tags: <Kbd>#project/apollo</Kbd> lives under <Kbd>#project</Kbd>.</li>
      <li><Kbd>#1abc</Kbd> and <Kbd>##heading</Kbd> are not tags (number / hash starts).</li>
      <li>Tags inside code blocks are ignored.</li>
      <li>Click any pill to see all notes with that tag.</li>
    </ul>

    {/* --- Links + attachments --- */}
    <H icon="ti-link">Note links + attachments</H>
    <p>
      Type <Kbd>[[</Kbd> to link to another note. A picker opens with notes from this notebook. Pick one — the link uses the note's title and survives renames.
    </p>
    <p>
      Type <Kbd>![[</Kbd> to embed a file. Images render inline. Other files render as a download pill.
    </p>
    <p>You can also drag files onto the editor or paste from the clipboard.</p>
    <Callout variant="info">
      <p>Images over 10 MB are auto-resized to fit. The original is not stored — what you see is what is saved.</p>
    </Callout>

    {/* --- Tables + formulas --- */}
    <H icon="ti-table">Tables and formulas</H>
    <p>
      Use <Kbd>/table</Kbd> to insert. Edit cells inline; the toolbar adds rows and columns.
    </p>
    <p>
      Cells can compute from other cells. Start the cell with <Kbd>:</Kbd>:
    </p>
    <Code>{`:sum(A1:A5)
:avg(B2:B10)
:A1+B1
:round(:sum(C2:C7), 2)`}</Code>
    <ul class="ml-4 list-disc space-y-1">
      <li>Column references: <Kbd>A1</Kbd>, <Kbd>B2</Kbd>, etc. Ranges: <Kbd>A1:A5</Kbd>.</li>
      <li>Functions: <Kbd>sum</Kbd>, <Kbd>avg</Kbd>, <Kbd>min</Kbd>, <Kbd>max</Kbd>, <Kbd>count</Kbd>, <Kbd>round</Kbd>, <Kbd>abs</Kbd>, <Kbd>sqrt</Kbd>, <Kbd>if</Kbd>.</li>
      <li>Type <Kbd>@</Kbd> inside a formula for column-name autocomplete.</li>
    </ul>

    {/* --- Math + diagrams --- */}
    <H icon="ti-math-function">Math and diagrams</H>
    <p>
      Inline math uses single dollars: <Kbd>$x^2 + y^2 = z^2$</Kbd>. Block math uses double dollars on their own lines:
    </p>
    <Code>{`$$
\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}
$$`}</Code>
    <p>
      Diagrams use a <Kbd>mermaid</Kbd> code fence:
    </p>
    <Code>{`\`\`\`mermaid
graph TD
  A[Start] --> B{Decision}
  B -->|yes| C[Do it]
  B -->|no| D[Skip]
\`\`\``}</Code>
    <p class="text-[12px] text-dimmed">Both render live. Click a rendered widget to edit the source.</p>

    {/* --- Info blocks --- */}
    <H icon="ti-alert-circle">Callout blocks</H>
    <p>For notes that need to stand out:</p>
    <Code>{`:::info
Heads up.
:::

:::warning
Watch out.
:::`}</Code>
    <p>
      Variants: <Kbd>info</Kbd>, <Kbd>warning</Kbd>, <Kbd>success</Kbd>, <Kbd>danger</Kbd>, <Kbd>note</Kbd>.
    </p>

    {/* --- Scripting --- */}
    <H icon="ti-code">Scripting</H>
    <Callout variant="warning">
      <p>
        <strong>Scripts run JavaScript in your browser.</strong> Only enable for notebooks you trust.
      </p>
      <p>A malicious script in a shared notebook can:</p>
      <ul class="ml-4 list-disc">
        <li>read every note in this notebook</li>
        <li>upload files to this notebook as you</li>
        <li>call APIs with your session</li>
      </ul>
      <p>Turn scripts off in the notebook settings if unsure.</p>
    </Callout>
    <p>
      To enable: open the notebook settings (cog icon) and toggle Scripts on. Then write a code fence with language <Kbd>script</Kbd>:
    </p>
    <Code>{`\`\`\`script
const notes = await kit.notes.list();
return \`This notebook has \${notes.length} notes.\`;
\`\`\``}</Code>
    <p>The return value renders below the block. The <Kbd>kit</Kbd> object exposes:</p>
    <RefTable
      rows={[
        { left: <span>kit.note</span>, right: <span>current note — read fields, edit content</span> },
        { left: <span>kit.notes</span>, right: <span>list / search / create notes in this notebook</span> },
        { left: <span>kit.attachments</span>, right: <span>list / upload / get files</span> },
        { left: <span>kit.tags</span>, right: <span>tag index of this notebook</span> },
        { left: <span>kit.state</span>, right: <span>shared key-value store per note (collaborative)</span> },
        { left: <span>kit.localState</span>, right: <span>private key-value store per user (this browser)</span> },
        { left: <span>kit.ui</span>, right: <span>open prompts, show toasts</span> },
      ]}
    />

    {/* --- Files & images --- */}
    <H icon="ti-paperclip">Files and images</H>
    <ul class="ml-4 list-disc space-y-1">
      <li>Drag files onto the editor, or paste from the clipboard (screenshots work).</li>
      <li>Images larger than 10 MB are auto-resized. A toast tells you the new size.</li>
      <li>Non-image files larger than 10 MB are rejected — pick a smaller file.</li>
      <li>All attachments are stored with the notebook. Open the Attachments view from the sidebar to manage them.</li>
      <li>Markdown links use <Kbd>attach://shortId</Kbd> so renames don't break references.</li>
    </ul>

    {/* --- Shortcuts --- */}
    <H icon="ti-keyboard">Keyboard shortcuts</H>
    <p class="text-[12px] text-dimmed">Mod = Cmd on Mac, Ctrl on Windows / Linux.</p>
    <RefTable
      rows={[
        { left: <span>Mod + B</span>, right: <span>bold</span> },
        { left: <span>Mod + I</span>, right: <span>italic</span> },
        { left: <span>Mod + E</span>, right: <span>inline code</span> },
        { left: <span>Mod + K</span>, right: <span>insert link</span> },
        { left: <span>Mod + Alt + K</span>, right: <span>insert link to another note</span> },
        { left: <span>Mod + Shift + S</span>, right: <span>strikethrough</span> },
        { left: <span>Mod + Shift + H</span>, right: <span>cycle heading level</span> },
        { left: <span>Mod + Shift + K</span>, right: <span>open global search</span> },
        { left: <span>/</span>, right: <span>open the slash-command menu</span> },
        { left: <span>[[</span>, right: <span>link to another note</span> },
        { left: <span>![[</span>, right: <span>embed an attachment</span> },
        { left: <span>#</span>, right: <span>insert / autocomplete a tag</span> },
      ]}
    />

    {/* --- Footer --- */}
    <p class="mt-6 text-[12px] text-dimmed">
      Missing something? Open a notebook with <Kbd>scripts</Kbd> on and ask <Kbd>kit</Kbd> what it can do — every method has TypeScript types in your editor's autocomplete.
    </p>
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
