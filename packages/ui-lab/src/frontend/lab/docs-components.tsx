import { DocCode, DocConceptGrid, DocInlineCode, DocLead, DocNote, DocPage, DocRows, DocSection } from "@valentinkolb/cloud/ui";
import { highlight } from "@valentinkolb/stdlib";
import DemoCard from "./DemoCard";

const FROM_UI = "@valentinkolb/cloud/ui";

const pulseHighlighter = highlight.compile(
  [
    { kind: "string", match: /"(?:\\[\s\S]|[^"\\])*"/ },
    { kind: "placeholder", match: /<[^>\n]+>|\[[^\]\n]+\]/ },
    { kind: "uuid", match: /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i },
    { kind: "keyword", match: /\b(?:stream|every|since|source|where)\b/i },
    { kind: "aggregation", match: /\b(?:avg|sum|min|max|count|latest|rate|increase|p50|p90|p95|p99)\b/i },
    { kind: "duration", match: /\b\d+(?:m|h|d)\b/i },
    { kind: "operator", match: /=|,/ },
    { kind: "identifier", match: /[A-Za-z_][A-Za-z0-9_.-]*/ },
  ],
  { classPrefix: "doc-token-" },
);

const formatPulseQuery = (query: string): string => query.replace(/\s+(every|since|source|where)\b/gi, "\n$1").replace(/,\s*/g, ",\n  ");

export const DocComponentsDemo = () => (
  <DemoCard
    id="doc-components"
    chip={{ kind: "component", name: "DocPage / DocSection / DocRows", from: FROM_UI }}
    description="Shared in-product documentation components for global help tabs and technical docs. Keep app help visually consistent without rebuilding cards, notes, and code snippets per app."
    code={`<DocPage>
  <DocLead>Short orientation paragraph.</DocLead>
  <DocSection title="Concepts" eyebrow="Start here">
    <DocConceptGrid items={[…]} />
  </DocSection>
  <DocNote title="Naming rule">Use stable names.</DocNote>
</DocPage>`}
  >
    <DocPage>
      <DocLead>
        Doc components are for app-specific help, setup guides, and short technical references. They provide a consistent reading rhythm
        without forcing every app into the same content.
      </DocLead>

      <DocSection title="Concepts" eyebrow="Start here">
        <DocConceptGrid
          items={[
            {
              title: "DocPage",
              icon: "ti-file-text",
              text: "Centers the reading area and sets the shared text rhythm.",
            },
            {
              title: "DocSection",
              icon: "ti-layout-list",
              text: "Groups one topic with an optional eyebrow and a compact heading.",
            },
            {
              title: "DocRows",
              icon: "ti-list-details",
              text: "Displays feature or reference rows without nested cards.",
            },
            {
              title: "DocCode",
              icon: "ti-code",
              text: "Shows code with a GitHub-style light/dark theme and optional custom highlighting.",
            },
          ]}
        />
      </DocSection>

      <DocSection title="Rows">
        <DocRows
          items={[
            {
              title: "Lead",
              icon: "ti-align-left",
              text: "Use one lead paragraph per tab to orient the reader before details.",
            },
            {
              title: "Inline code",
              icon: "ti-braces",
              text: (
                <>
                  Use <DocInlineCode>DocInlineCode</DocInlineCode> for literal names, paths, flags, or DSL tokens.
                </>
              ),
            },
            {
              title: "Notes",
              icon: "ti-info-circle",
              text: "Use notes for constraints, warnings, and rules that should stand apart from normal prose.",
            },
          ]}
        />
      </DocSection>

      <DocNote title="Copy stays optional" variant="tip">
        `DocCode` can show a copy button, but docs examples can stay quieter when copying is not the main action.
      </DocNote>
    </DocPage>
  </DemoCard>
);

export const DocCodeDemo = () => (
  <DemoCard
    id="doc-code"
    chip={{ kind: "component", name: "DocCode", from: FROM_UI }}
    description="Docs-oriented code display. Use the built-in language highlighter or pass a custom stdlib highlighter for an app DSL."
    code={`const pulseHighlighter = highlight.compile([
  { kind: "keyword", match: /\\b(stream|every|since|where)\\b/i },
  { kind: "aggregation", match: /\\b(avg|latest|rate|p95)\\b/i },
], { classPrefix: "doc-token-" });

<DocCode
  code="stream system.cpu.usage avg every 5m since 24h"
  highlight={pulseHighlighter}
  format={formatPulseQuery}
  copy
/>`}
  >
    <div class="grid gap-4">
      <DocCode
        title="Pulse query"
        code={'stream system.memory.used_percent latest every 1m since 6h where host="83043661c361"'}
        highlight={pulseHighlighter}
        format={formatPulseQuery}
        copy
      />
      <DocCode
        title="TypeScript"
        code={`const result = await fetch("/api/pulse/query");
if (!result.ok) throw new Error("Query failed");`}
        language="ts"
        lineNumbers
        copy
      />
    </div>
  </DemoCard>
);
