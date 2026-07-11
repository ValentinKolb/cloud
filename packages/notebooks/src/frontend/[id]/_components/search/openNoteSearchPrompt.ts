import { openSpotlightSearch } from "@valentinkolb/cloud/ui";
import { apiClient } from "@/api/client";

type NoteResult = {
  id: string;
  shortId: string;
  title: string;
};

type SearchResponse = {
  data: Array<{
    note: NoteResult;
    snippet: string | null;
  }>;
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
    has_next: boolean;
  };
};

const PER_PAGE = 20;

const cleanSnippet = (snippet: string | null): string | undefined =>
  snippet?.replaceAll("\uE000", "").replaceAll("\uE001", "").replace(/\s+/g, " ").trim() || undefined;

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

const runNotePrompt = async (notebookId: string, dressing: PromptDressing): Promise<PickedNote | undefined> => {
  const selected = await openSpotlightSearch<PickedNote>({
    title: dressing.title,
    icon: dressing.icon,
    placeholder: dressing.placeholder,
    minQueryLength: 1,
    noResultsText: "No notes found.",
    resolve: async ({ query, abortSignal }) => {
      const trimmed = query.trim();
      if (trimmed.length === 0) return [];

      const response = await apiClient.search.$get(
        {
          query: { q: trimmed, notebook: notebookId, page: "1", per_page: String(PER_PAGE) },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) return [];

      const payload = await response.json();
      return (payload as SearchResponse).data.map((hit) => ({
        value: { id: hit.note.id, shortId: hit.note.shortId, title: hit.note.title },
        label: hit.note.title,
        desc: cleanSnippet(hit.snippet),
      }));
    },
  });

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
