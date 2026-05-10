/**
 * `kit.notes` — query / mutate OTHER notes in the same notebook.
 *
 * Hard boundary: this module never accepts a notebook parameter and
 * the caller cannot reach across notebooks. `get(shortId)` returns
 * null when the resolved note belongs to a different notebook.
 *
 * Content mutations on other notes are intentionally NOT supported.
 * Body changes go through each note's own yjs collab session;
 * persisting via a one-shot HTTP write would skip that path and
 * cause merge conflicts when other peers are editing. If a script
 * needs to set content programmatically, do it on the CURRENT note
 * via `kit.note.setContent` (which does mutate Y.Text correctly) —
 * or open the target note manually.
 */
import { apiClient } from "../../../api/client";
import type { KitContext, KitNote, KitNotesAPI, KitQuery } from "./kit-types";

// =============================================================================
// Wire shape (matches NoteSchema in api/index.ts)
// =============================================================================

type ApiNote = {
  id: string;
  shortId: string;
  notebookId: string;
  parentId: string | null;
  title: string;
  contentMd: string | null;
  createdAt: string;
  updatedAt: string;
  lockedAt: string | null;
};

const TAG_REGEX = /(?:^|\s)#([\p{L}\p{N}_-]+)/gu;

const extractTags = (content: string | null): string[] => {
  if (!content) return [];
  const set = new Set<string>();
  for (const match of content.matchAll(TAG_REGEX)) {
    if (match[1]) set.add(match[1].toLowerCase());
  }
  return [...set];
};

const toKitNote = (n: ApiNote): KitNote => ({
  id: n.shortId,
  title: n.title,
  content: n.contentMd,
  tags: extractTags(n.contentMd),
  parentId: n.parentId,
  createdAt: n.createdAt,
  updatedAt: n.updatedAt,
  lockedAt: n.lockedAt,
});

// =============================================================================
// Search-result post-filter
// =============================================================================

/** Apply the parts of a `KitQuery` the API doesn't natively filter
 *  on — date ranges, tags. Done client-side because the
 *  notebook-scope cap (typical notebook is hundreds of notes, not
 *  millions) makes this cheap; if performance ever bites, lift to
 *  server-side query params. */
const postFilter = (notes: KitNote[], query: KitQuery): KitNote[] => {
  let out = notes;
  if (query.tags && query.tags.length > 0) {
    const wanted = new Set(query.tags.map((t) => t.toLowerCase()));
    out = out.filter((n) => {
      const has = new Set(n.tags);
      for (const t of wanted) if (!has.has(t)) return false;
      return true;
    });
  }
  if (query.createdAfter) out = out.filter((n) => n.createdAt >= query.createdAfter!);
  if (query.createdBefore) out = out.filter((n) => n.createdAt <= query.createdBefore!);
  if (query.updatedAfter) out = out.filter((n) => n.updatedAt >= query.updatedAfter!);
  if (query.updatedBefore) out = out.filter((n) => n.updatedAt <= query.updatedBefore!);
  return out;
};

// =============================================================================
// Factory
// =============================================================================

export const createKitNotesAPI = (ctx: KitContext): KitNotesAPI => {
  const list = async (): Promise<KitNote[]> => {
    // Use the existing /:id/notes endpoint with no filters. The API
    // returns paginated results — for "list everything" we ask for
    // a generous per-page count and assume one round-trip.
    const res = await apiClient[":id"].notes.$get({
      param: { id: ctx.notebookId },
      query: { per_page: "200" },
    });
    if (!res.ok) throw new Error("kit.notes.list: API call failed");
    const payload = (await res.json()) as { data: ApiNote[] };
    return payload.data.map(toKitNote);
  };

  const get = async (shortId: string): Promise<KitNote | null> => {
    const res = await apiClient[":id"].notes[":noteId"].$get({
      param: { id: ctx.notebookId, noteId: shortId },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("kit.notes.get: API call failed");
    const note = (await res.json()) as ApiNote;
    // Defensive: re-check the notebook scope. The API endpoint
    // already enforces this via `requireNoteInNotebook`, but a
    // misbehaving / stubbed API client shouldn't be able to leak
    // cross-notebook notes through this path.
    if (note.notebookId !== ctx.notebookId) return null;
    return toKitNote(note);
  };

  const search = async (query: string | KitQuery): Promise<KitNote[]> => {
    // Normalise: string overload becomes `{ search: <string> }`.
    const q: KitQuery = typeof query === "string" ? { search: query } : query;
    const limit = Math.min(q.limit ?? 50, 200);
    const offset = q.offset ?? 0;

    const apiQuery: Record<string, string> = {
      per_page: String(limit),
      page: String(Math.floor(offset / limit) + 1),
    };
    if (q.search) apiQuery.q = q.search;

    const res = await apiClient[":id"].notes.$get({
      param: { id: ctx.notebookId },
      query: apiQuery,
    });
    if (!res.ok) throw new Error("kit.notes.search: API call failed");
    const payload = (await res.json()) as { data: ApiNote[] };
    let notes = payload.data.map(toKitNote);
    notes = postFilter(notes, q);
    return notes;
  };

  const create = async (data: { title: string; parentId?: string }): Promise<KitNote> => {
    const res = await apiClient[":id"].notes.$post({
      param: { id: ctx.notebookId },
      json: data,
    });
    if (!res.ok) throw new Error("kit.notes.create: API call failed");
    const note = (await res.json()) as ApiNote;
    return toKitNote(note);
  };

  const update = async (
    shortId: string,
    data: { title?: string; parentId?: string | null },
  ): Promise<KitNote> => {
    const res = await apiClient[":id"].notes[":noteId"].$patch({
      param: { id: ctx.notebookId, noteId: shortId },
      json: data,
    });
    if (!res.ok) throw new Error("kit.notes.update: API call failed");
    const note = (await res.json()) as ApiNote;
    return toKitNote(note);
  };

  const remove = async (shortId: string): Promise<void> => {
    const res = await apiClient[":id"].notes[":noteId"].$delete({
      param: { id: ctx.notebookId, noteId: shortId },
    });
    if (!res.ok) throw new Error("kit.notes.remove: API call failed");
  };

  return { list, get, search, create, update, remove };
};
