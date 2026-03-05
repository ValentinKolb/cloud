import { prompts } from "@valentinkolb/cloud/lib/ui";

type NoteResult = {
  id: string;
  title: string;
  contentMd: string | null;
};

type SearchResponse = {
  data: NoteResult[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
    has_next: boolean;
  };
};

const PER_PAGE = 20;

const getSnippet = (content: string | null, query: string): string | undefined => {
  if (!content) return undefined;
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return undefined;
  const lower = content.toLowerCase();
  const idx = lower.indexOf(normalizedQuery);
  if (idx === -1) return content.replace(/\n/g, " ").trim().slice(0, 120) || undefined;
  const start = Math.max(0, idx - 40);
  const end = Math.min(content.length, idx + normalizedQuery.length + 80);
  let snippet = content.slice(start, end).replace(/\n/g, " ").trim();
  if (snippet.length === 0) return undefined;
  if (start > 0) snippet = `...${snippet}`;
  if (end < content.length) snippet = `${snippet}...`;
  return snippet;
};

export const openNoteSearchPrompt = async (notebookId: string, notebookName: string): Promise<string | undefined> => {
  const selected = await prompts.search<string>(
    async ({ query, abortSignal }) => {
      const trimmed = query.trim();
      if (trimmed.length === 0) return [];

      const params = new URLSearchParams({
        q: trimmed,
        page: "1",
        per_page: String(PER_PAGE),
      });

      const response = await fetch(`/api/app/notebooks/${encodeURIComponent(notebookId)}/search?${params.toString()}`, {
        signal: abortSignal,
      });
      if (!response.ok) return [];

      const payload = (await response.json()) as SearchResponse;
      return payload.data.map((note) => ({
        value: note.id,
        label: note.title,
        desc: getSnippet(note.contentMd, trimmed),
      }));
    },
    {
      title: `Search in ${notebookName}`,
      icon: "ti ti-notebook",
      placeholder: "Search notes...",
      minQueryLength: 1,
      noResultsText: "No notes found.",
      size: "small",
    },
  );

  return selected?.value;
};
