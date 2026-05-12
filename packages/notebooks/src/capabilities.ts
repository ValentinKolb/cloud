import type { AppSearchInput, AppSearchResult } from "@valentinkolb/cloud/contracts";
import { notebooksService } from "./service";

const SEARCH_TAGS = ["note", "notebook", "markdown"] as const;
const SEARCH_HELP = "Find notebooks and notes by title or content.";
const SEARCH_TAG_HELP = [
  { tag: "note", help: "Show notes only." },
  { tag: "notebook", help: "Show notebooks only." },
  { tag: "markdown", help: "Show notes only (alias of #note)." },
] as const;

const snippet = (content: string | null) => {
  if (!content) return undefined;
  const compact = content.replace(/\s+/g, " ").trim();
  if (compact.length === 0) return undefined;
  return compact.slice(0, 120);
};

export const search = async (input: AppSearchInput): Promise<AppSearchResult[]> => {
  const user = input.ctx.get("user");
  const tags = new Set(input.tags);

  // Kind-tags are OR-merged within this app (they pick result kinds, not facets).
  // No tag → both kinds.
  const kindActive = tags.has("note") || tags.has("notebook") || tags.has("markdown");
  const includeNotebooks = !kindActive || tags.has("notebook");
  const includeNotes = !kindActive || tags.has("note") || tags.has("markdown");

  if (!includeNotebooks && !includeNotes) return [];

  // Notebook list is needed only when we render notebook results. Note search
  // goes through `searchAcross` which carries its own permission boundary.
  const [notebooksPage, noteHits] = await Promise.all([
    includeNotebooks
      ? notebooksService.notebook.list({
          userId: user.id,
          groups: user.memberofGroupIds,
          pagination: { page: 1, perPage: input.limit },
          filter: { query: input.query },
        })
      : Promise.resolve({ items: [], page: 1, perPage: 0, total: 0, hasNext: false }),
    includeNotes
      ? notebooksService.note.searchAcross({
          userId: user.id,
          groups: user.memberofGroupIds,
          query: input.query,
          limit: input.limit,
        })
      : Promise.resolve([]),
  ]);

  const notebookItems = notebooksPage.items.map((entry) => ({
    id: `notebook:${entry.id}`,
    title: entry.name,
    href: `/app/notebooks/${entry.id}`,
    preview: entry.description ?? undefined,
    icon: entry.icon ?? "ti ti-notebook",
    priority: 7 as const,
    metadata: [
      { label: "Type", value: "Notebook" },
      { label: "Notebook", value: entry.name },
    ],
  }));

  const noteItems: AppSearchResult[] = noteHits.map(({ note, notebook }) => ({
    id: `note:${note.id}`,
    title: note.title,
    href: `/app/notebooks/${notebook.id}?note=${note.id}`,
    preview: snippet(note.contentMd),
    icon: "ti ti-file-text",
    priority: 8 as const,
    metadata: [
      { label: "Type", value: "Note" },
      { label: "Notebook", value: notebook.name },
    ],
  }));

  return [...noteItems, ...notebookItems].slice(0, input.limit);
};

export const notebooksCapabilities = {
  search: {
    tags: [...SEARCH_TAGS],
    help: SEARCH_HELP,
    tagHelp: [...SEARCH_TAG_HELP],
    run: search,
  },
} as const;

