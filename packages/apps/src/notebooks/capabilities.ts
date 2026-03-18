import type { AppSearchInput, AppSearchResult } from "@valentinkolb/cloud/contracts/app";
import { notebooksService } from "./service";

const SEARCH_TAGS = ["note", "notebook", "markdown"] as const;
const SEARCH_HELP = "Find notebooks and notes by title or content.";
const SEARCH_TAG_HELP = [
  { tag: "note", help: "Show notes." },
  { tag: "notebook", help: "Show notebook entries." },
  { tag: "markdown", help: "Search markdown-based notes." },
] as const;
const hasAllTags = (requested: string[]) => requested.every((tag) => SEARCH_TAGS.includes(tag as (typeof SEARCH_TAGS)[number]));

const snippet = (content: string | null) => {
  if (!content) return undefined;
  const compact = content.replace(/\s+/g, " ").trim();
  if (compact.length === 0) return undefined;
  return compact.slice(0, 120);
};

export const search = async (input: AppSearchInput): Promise<AppSearchResult[]> => {
  const user = input.ctx.get("user");
  if (input.tags.length > 0 && !hasAllTags(input.tags)) return [];

  const notebooksPage = await notebooksService.notebook.list({
    userId: user.id,
    groups: user.memberofGroupIds,
    pagination: { page: 1, perPage: input.limit },
    filter: { query: input.query },
  });

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

  const notebooksForNotes = notebooksPage.items;
  const notePages = await Promise.all(
    notebooksForNotes.map((notebook) =>
      notebooksService.note.search({
        notebookId: notebook.id,
        query: input.query,
        pagination: {
          page: 1,
          perPage: input.limit,
          offset: 0,
        },
      }),
    ),
  );

  const noteItems = notePages.flatMap((page, index) => {
    const notebook = notebooksForNotes[index];
    if (!notebook) return [];
    return page.notes.map((note) => ({
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
  });

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
