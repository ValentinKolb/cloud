import { onCleanup, onMount } from "solid-js";
import { apiClient } from "@/api/client";
import { hotkeys, mutation as mutations } from "@valentinkolb/stdlib/solid";
import { prompts, SPOTLIGHT_SHORTCUT } from "@valentinkolb/cloud/ui";
import { buildNoteUrl } from "../../../params";
import { onNotebookSearchRequest } from "../../../lib/hotkeys";
import { navigateToNotebookNote } from "../../../lib/soft-navigation";
import { openNoteSearchPrompt } from "../search/openNoteSearchPrompt";

type Props = {
  notebookId: string;
  notebookName: string;
  canWrite: boolean;
};

type CreateNoteResult = {
  id: string;
  shortId: string;
};

/** Note-level notebook shortcuts to avoid duplicate registrations from responsive sidebars. */
export default function NotebookHotkeys(props: Props) {
  const createNoteMutation = mutations.create<CreateNoteResult, { title: string }>({
    mutation: async (data) => {
      const res = await apiClient[":id"].notes.$post({
        param: { id: props.notebookId },
        json: data,
      });
      if (!res.ok) throw new Error("Failed to create note");
      return (await res.json()) as CreateNoteResult;
    },
    onSuccess: (data) => {
      void navigateToNotebookNote(buildNoteUrl(props.notebookId, data.shortId));
    },
    onError: (err) => prompts.error(err.message),
  });

  const openSearch = async () => {
    const picked = await openNoteSearchPrompt(props.notebookId, props.notebookName);
    if (picked) {
      void navigateToNotebookNote(buildNoteUrl(props.notebookId, picked.shortId));
    }
  };

  const createNote = async () => {
    if (!props.canWrite || createNoteMutation.loading()) return;
    const result = await prompts.form({
      title: "New Note",
      icon: "ti ti-file-plus",
      fields: {
        title: {
          type: "text" as const,
          label: "Title",
          required: true,
          placeholder: "Note title",
        },
      },
    });
    if (result) {
      await createNoteMutation.mutate(result);
    }
  };

  onMount(() => {
    const offSearchRequest = onNotebookSearchRequest(() => {
      void openSearch();
    });
    onCleanup(offSearchRequest);
  });

  hotkeys.create(() => ({
    [SPOTLIGHT_SHORTCUT]: {
      label: "Search Notes",
      desc: "Open notebook note search.",
      run: openSearch,
    },
    ...(props.canWrite
      ? {
          "mod+alt+n": {
            label: "New Note",
            desc: "Create a new note in this notebook.",
            run: createNote,
          },
        }
      : {}),
  }));

  return null;
}
