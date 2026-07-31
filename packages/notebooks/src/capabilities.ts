import {
  type CapabilityExecutionContext,
  type CloudResourceView,
  defineCapabilities,
  type UniversalSearchInput,
  UniversalSearchDataSchema,
  UniversalSearchInputSchema,
} from "@valentinkolb/cloud/contracts";
import { ok } from "@k2b/stdlib";
import { notebooksService } from "./service";

const snippet = (content: string | null) => {
  if (!content) return undefined;
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.length === 0 ? undefined : compact.slice(0, 120);
};

const cleanSearchSnippet = (value: string | null): string | undefined =>
  value ? value.replaceAll("\uE000", "").replaceAll("\uE001", "").trim() || undefined : undefined;

const runSearch = async (input: UniversalSearchInput, context: CapabilityExecutionContext) => {
  const user = context.user;
  if (!user) return ok({ data: [] });
  const tags = new Set(input.tags);
  const kindActive = tags.has("note") || tags.has("notebook") || tags.has("markdown");
  const includeNotebooks = !kindActive || tags.has("notebook");
  const includeNotes = !kindActive || tags.has("note") || tags.has("markdown");
  if (!includeNotebooks && !includeNotes) return ok({ data: [] });

  const [notebooksPage, noteHits] = await Promise.all([
    includeNotebooks
      ? notebooksService.notebook.list({
          userId: user.id,
          pagination: { page: 1, perPage: input.limit },
          filter: { query: input.query },
        })
      : Promise.resolve({ items: [], page: 1, perPage: 0, total: 0, hasNext: false }),
    includeNotes
      ? notebooksService.note.searchAcross({
          userId: user.id,
          filters: { query: input.query },
          pagination: { page: 1, perPage: input.limit, offset: 0 },
        })
      : Promise.resolve({ hits: [], total: 0 }),
  ]);

  const notebookItems: CloudResourceView[] = notebooksPage.items.map((entry) => ({
    ref: { type: "notebooks.notebook", id: entry.id },
    title: entry.name,
    preview: entry.description ?? undefined,
    icon: entry.icon ?? "ti ti-notebook",
    priority: 7,
    metadata: [
      { label: "Type", value: "Notebook" },
      { label: "Notebook", value: entry.name },
    ],
    links: [{ rel: "open", href: `/app/notebooks/${entry.shortId}` }],
  }));
  const noteItems: CloudResourceView[] = noteHits.hits.map(({ note, notebook, snippet: matchSnippet }) => ({
    ref: { type: "notebooks.note", id: note.id },
    title: note.title,
    preview: cleanSearchSnippet(matchSnippet) ?? snippet(note.contentMd),
    icon: "ti ti-file-text",
    priority: 8,
    metadata: [
      { label: "Type", value: "Note" },
      { label: "Notebook", value: notebook.name },
    ],
    links: [{ rel: "open", href: `/app/notebooks/${notebook.shortId}/notes/${note.shortId}` }],
  }));
  return ok({ data: [...noteItems, ...notebookItems].slice(0, input.limit) });
};

export const notebooksCapabilities = defineCapabilities({
  version: 1,
  types: {
    note: { title: "Note", description: "A Markdown note in an accessible notebook.", icon: "ti ti-file-text" },
    notebook: { title: "Notebook", description: "A permission-scoped collection of notes.", icon: "ti ti-notebook" },
  },
  queries: {
    search: {
      title: "Search notebooks",
      description: "Find accessible notes by title or content and notebooks by name.",
      input: UniversalSearchInputSchema,
      data: UniversalSearchDataSchema,
      universalSearch: {
        tags: [
          { tag: "note", title: "Notes", description: "Show notes only.", aliases: ["markdown"] },
          { tag: "notebook", title: "Notebooks", description: "Show notebooks only." },
        ],
      },
      run: runSearch,
    },
  },
});
