import { prompts } from "@valentinkolb/cloud/ui";
import { createEffect, createSignal } from "solid-js";
import { apiClient } from "@/api/client";
import type { NoteTreeNode } from "./types";

export function useFavoriteNotes(params: { notebookId: string; initialFavoriteNoteIds: () => string[] }) {
  const [favoriteNoteIds, setFavoriteNoteIds] = createSignal(new Set(params.initialFavoriteNoteIds()));

  createEffect(() => setFavoriteNoteIds(new Set(params.initialFavoriteNoteIds())));

  const toggleFavorite = async (note: NoteTreeNode, event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const next = !favoriteNoteIds().has(note.id);
    setFavoriteNoteIds((current) => {
      const copy = new Set(current);
      if (next) copy.add(note.id);
      else copy.delete(note.id);
      return copy;
    });

    const response = await apiClient[":id"].notes[":noteId"].favorite.$put({
      param: { id: params.notebookId, noteId: note.shortId },
      json: { favorite: next },
    });
    if (!response.ok) {
      setFavoriteNoteIds((current) => {
        const copy = new Set(current);
        if (next) copy.delete(note.id);
        else copy.add(note.id);
        return copy;
      });
      void prompts.error("Failed to update favorite.");
    }
  };

  return { favoriteNoteIds, toggleFavorite };
}
