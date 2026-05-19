/**
 * `nb.tags` — tag listing for the current notebook.
 *
 * `notesForTag` does NOT have a dedicated server endpoint yet
 * (only the SSR /tags/:tag page does); for V1 we reuse
 * `currents.search({ tags: [...] })` which fetches the note list
 * and post-filters by tag client-side. Cheap for typical
 * notebooks; if the notebook grows large move this server-side
 * via a new `/tags/:tag/notes` endpoint.
 *
 * Raw-fetch for the same reason as `kit-attachments.ts`: the
 * Hono-derived `apiClient` type doesn't expose `.tags` because
 * those routes are defined on a separate chain.
 */
import { createKitNotesAPI } from "./kit-notes";
import type { KitContext, KitNote, KitTagSummary, KitTagsAPI } from "./kit-types";

export const createKitTagsAPI = (ctx: KitContext): KitTagsAPI => {
  const list = async (): Promise<KitTagSummary[]> => {
    const res = await fetch(`/api/notebooks/${encodeURIComponent(ctx.notebookId)}/tags`);
    if (!res.ok) throw new Error("nb.tags.list: API call failed");
    return (await res.json()) as KitTagSummary[];
  };

  const notesForTag = async (tag: string): Promise<KitNote[]> => {
    // Reuse the notes API's tag-filter post-processor by passing
    // `{ tags: [tag] }` to search. Single source of truth for the
    // tag matching logic — same regex / lowercasing as the rest.
    const notes = createKitNotesAPI(ctx);
    return notes.search({ tags: [tag.toLowerCase()] });
  };

  return { list, notesForTag };
};
