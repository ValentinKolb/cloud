import { prompts } from "@valentinkolb/cloud/ui";

type NoteResult = {
  id: string;
  shortId: string;
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

export type PickedNote = {
  id: string;
  shortId: string;
  title: string;
};

type PromptDressing = {
  title: string;
  icon: string;
  placeholder: string;
};

const runNotePrompt = async (
  notebookId: string,
  dressing: PromptDressing,
): Promise<PickedNote | undefined> => {
  const selected = await prompts.search<PickedNote>(
    async ({ query, abortSignal }) => {
      const trimmed = query.trim();
      if (trimmed.length === 0) return [];

      const params = new URLSearchParams({
        q: trimmed,
        page: "1",
        per_page: String(PER_PAGE),
      });

      const response = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/search?${params.toString()}`, {
        signal: abortSignal,
      });
      if (!response.ok) return [];

      const payload = (await response.json()) as SearchResponse;
      return payload.data.map((note) => ({
        value: { id: note.id, shortId: note.shortId, title: note.title },
        label: note.title,
        desc: getSnippet(note.contentMd, trimmed),
      }));
    },
    {
      title: dressing.title,
      icon: dressing.icon,
      placeholder: dressing.placeholder,
      minQueryLength: 1,
      noResultsText: "No notes found.",
      size: "small",
    },
  );

  return selected?.value;
};

/** Search prompt used by the global Cmd+Shift+K shortcut and the sidebar
 *  search button — selecting a note navigates to it. */
export const openNoteSearchPrompt = (notebookId: string, notebookName: string): Promise<PickedNote | undefined> =>
  runNotePrompt(notebookId, {
    title: `Search in ${notebookName}`,
    icon: "ti ti-notebook",
    placeholder: "Search notes...",
  });

/** Picker variant used by the editor's "Insert note link" action — wording
 *  makes it clear the picked note will be inserted as a link, not navigated to. */
export const openNoteLinkPrompt = (notebookId: string): Promise<PickedNote | undefined> =>
  runNotePrompt(notebookId, {
    title: "Insert link to note",
    icon: "ti ti-connection",
    placeholder: "Search note to link to...",
  });

/** Picker variant used by the `/switch` slash command — picks a note to
 *  navigate to (within the current notebook). */
export const openNoteSwitchPrompt = (notebookId: string): Promise<PickedNote | undefined> =>
  runNotePrompt(notebookId, {
    title: "Switch to note",
    icon: "ti ti-arrows-right-left",
    placeholder: "Search note to open...",
  });
