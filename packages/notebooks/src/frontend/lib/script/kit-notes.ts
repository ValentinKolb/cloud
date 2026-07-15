/**
 * `nb` — query / mutate OTHER notes in the same notebook.
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
 * via `current.setContent` (which does mutate Y.Text correctly) —
 * or open the target note manually.
 */
import { apiClient } from "../../../api/client";
import { extractTags } from "../tag-extract";
import { createReadableNoteBlocks } from "./kit-blocks";
import { assertActive, type KitContext, type KitNote, type KitNotesAPI, type KitQuery } from "./kit-types";

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

const toKitNote = (n: ApiNote, parentId: string | null): KitNote => {
  let tags: string[] | undefined;
  const blocks = createReadableNoteBlocks(() => n.contentMd);
  return {
    table: blocks.table,
    tables: blocks.tables,
    list: blocks.list,
    lists: blocks.lists,
    todo: blocks.todo,
    todos: blocks.todos,
    data: blocks.data,
    dataBlocks: blocks.dataBlocks,
    section: blocks.section,
    sections: blocks.sections,
    id: n.shortId,
    title: n.title,
    content: n.contentMd,
    get tags() {
      tags ??= extractTags(n.contentMd);
      return tags;
    },
    parentId,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    lockedAt: n.lockedAt,
  };
};

const toKitNotesWithShortParents = (notes: ApiNote[]): KitNote[] => {
  const shortByUuid = new Map(notes.map((note) => [note.id, note.shortId]));
  return notes.map((note) => toKitNote(note, note.parentId ? (shortByUuid.get(note.parentId) ?? null) : null));
};

// =============================================================================
// Pagination helpers
// =============================================================================

/** Server-side per-page cap (`PaginationQuerySchema.per_page.max` in
 *  `cloud/contracts/shared.ts`). The API silently clamps higher
 *  values; we cap explicitly here so we know how many pages to walk. */
const API_PER_PAGE_MAX = 100;

/** Hard ceiling on total notes fetched in one slow-path search.
 *  Past this we stop walking pages and return what we have — a
 *  safety net against a notebook with tens of thousands of notes
 *  freezing the script with a giant fetch. Document if a script
 *  ever needs more, the workaround is multiple `search()` calls
 *  with explicit `offset` / `limit` (which already hit the fast
 *  path when no post-filter is in use). */
const SEARCH_FETCH_CAP = 1000;

/** Walk through paginated `/:id/notes` starting at `startPage` and
 *  collect at most `maxItems` notes (or until the response runs
 *  dry). Used by:
 *   - `list()` — full notebook scan, startPage = 1, max = SEARCH_FETCH_CAP
 *   - search slow path — same as list (we filter, then slice)
 *   - search fast path — startPage seeked to the page containing
 *     `userOffset` so we don't refetch every prior page (codex
 *     review on commit 40ee626: fast-path offset pagination must
 *     be O(limit), not O(offset)).
 *  Server-side `q` is forwarded when given.
 *
 *  Returns the contiguous slice STARTING AT `startPage` — the
 *  caller is responsible for `out.slice(withinPageOffset, ...)` when
 *  they seeked into the middle of a page.
 *
 *  `truncated` is `true` when the loop exited because we hit
 *  `maxItems` AND the last fetched page was full (i.e. more data
 *  may exist server-side). The caller decides whether to surface
 *  this — `list()` ignores it (cap is documented), `search()`
 *  warns the user. */
const fetchPagesUpTo = async (
  notebookId: string,
  maxItems: number,
  searchQuery?: string,
  startPage = 1,
): Promise<{ items: KitNote[]; truncated: boolean }> => {
  const out: ApiNote[] = [];
  let page = startPage;
  while (out.length < maxItems) {
    const apiQuery: Record<string, string> = {
      per_page: String(API_PER_PAGE_MAX),
      page: String(page),
    };
    if (searchQuery) apiQuery.q = searchQuery;
    const res = await apiClient[":id"].notes.$get({
      param: { id: notebookId },
      query: apiQuery,
    });
    if (!res.ok) throw new Error("nb: API call failed");
    const payload = (await res.json()) as { data: ApiNote[]; pagination?: { total?: number } };
    if (payload.data.length === 0) return { items: toKitNotesWithShortParents(out), truncated: false };
    for (const n of payload.data) out.push(n);
    if (payload.data.length < API_PER_PAGE_MAX) return { items: toKitNotesWithShortParents(out), truncated: false }; // last page
    page++;
  }
  // Loop exited via the `out.length < maxItems` guard failing —
  // last page was full AND we hit the cap. Server may have more.
  return { items: toKitNotesWithShortParents(out), truncated: true };
};

const searchPages = async (notebookId: string, query: KitQuery, offset: number, limit: number): Promise<KitNote[]> => {
  const startPage = Math.floor(offset / API_PER_PAGE_MAX) + 1;
  const withinPageOffset = offset % API_PER_PAGE_MAX;
  const needed = withinPageOffset + limit;
  const out: ApiNote[] = [];
  let page = startPage;

  while (out.length < needed) {
    const apiQuery: Record<string, string> = {
      page: String(page),
      // Keep page size stable so page arithmetic remains correct when offset
      // starts beyond the first page.
      per_page: String(API_PER_PAGE_MAX),
    };
    if (query.search?.trim()) apiQuery.q = query.search.trim();
    if (query.tags?.length) apiQuery.tags = query.tags.map((tag) => tag.replace(/^#/, "")).join(",");
    if (query.createdAfter) apiQuery.created_after = query.createdAfter;
    if (query.createdBefore) apiQuery.created_before = query.createdBefore;
    if (query.updatedAfter) apiQuery.updated_after = query.updatedAfter;
    if (query.updatedBefore) apiQuery.updated_before = query.updatedBefore;

    const response = await apiClient[":id"].search.$get({ param: { id: notebookId }, query: apiQuery });
    if (!response.ok) throw new Error("nb.search: API call failed");
    const payload = (await response.json()) as { data: ApiNote[]; pagination: { has_next?: boolean } };
    out.push(...payload.data);
    if (payload.data.length === 0 || !payload.pagination.has_next) break;
    page++;
  }

  return toKitNotesWithShortParents(out).slice(withinPageOffset, withinPageOffset + limit);
};

// =============================================================================
// Factory
// =============================================================================

export const createKitNotesAPI = (ctx: KitContext): KitNotesAPI => {
  const list = async (): Promise<KitNote[]> => {
    // Walk every page so callers see the full notebook, not just
    // the first 100. Capped at SEARCH_FETCH_CAP to avoid runaway
    // fetches; the cap is documented on SEARCH_FETCH_CAP above so
    // we don't surface truncation noise here.
    const { items } = await fetchPagesUpTo(ctx.notebookId, SEARCH_FETCH_CAP);
    return items;
  };

  const get = async (shortId: string): Promise<KitNote | null> => {
    const res = await apiClient[":id"].notes[":noteId"].$get({
      param: { id: ctx.notebookId, noteId: shortId },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("nb.get: API call failed");
    const note = (await res.json()) as ApiNote;
    let parentId: string | null = null;
    if (note.parentId) {
      const parentRes = await apiClient[":id"].notes[":noteId"].$get({
        param: { id: ctx.notebookId, noteId: note.parentId },
      });
      if (parentRes.ok) parentId = ((await parentRes.json()) as ApiNote).shortId;
    }
    // The API endpoint already enforces notebook membership via
    // `requireNoteInNotebook` — a 404 above covers cross-notebook
    // ids. Don't re-check on the client: `note.notebookId` is the
    // canonical UUID and `ctx.notebookId` is the short-id, so a
    // local comparison would always reject (codex review on
    // commit 7ee5fdc, finding 2).
    return toKitNote(note, parentId);
  };

  const search = async (query: string | KitQuery): Promise<KitNote[]> => {
    // Normalise: string overload becomes `{ search: <string> }`.
    const q: KitQuery =
      typeof query === "string"
        ? /^#[a-zA-Z][\w-]*(?:\s+#[a-zA-Z][\w-]*)*$/.test(query.trim())
          ? {
              tags: query
                .trim()
                .split(/\s+/)
                .map((tag) => tag.slice(1)),
            }
          : { search: query }
        : query;
    const userLimit = Math.max(0, Math.min(q.limit ?? 50, 200));
    const userOffset = Math.max(0, q.offset ?? 0);

    return searchPages(ctx.notebookId, q, userOffset, userLimit);
  };

  const searchTags = async (tags: string | string[], options?: { limit?: number; offset?: number }) => {
    const normalized = (Array.isArray(tags) ? tags : [tags]).map((tag) => tag.replace(/^#/, "").toLowerCase());
    return search({ tags: normalized, limit: options?.limit, offset: options?.offset });
  };

  const create = async (data: { parentId?: string; content?: string } = {}): Promise<KitNote> => {
    assertActive(ctx);
    const res = await apiClient[":id"].notes.$post({
      param: { id: ctx.notebookId },
      json: { parentId: data.parentId, contentMd: data.content },
    });
    if (!res.ok) throw new Error("nb.create: API call failed");
    const note = (await res.json()) as ApiNote;
    return toKitNote(note, data.parentId ?? null);
  };

  const update = async (shortId: string, data: { parentId: string | null }): Promise<KitNote> => {
    assertActive(ctx);
    const res = await apiClient[":id"].notes[":noteId"].$patch({
      param: { id: ctx.notebookId, noteId: shortId },
      json: data,
    });
    if (!res.ok) throw new Error("nb.update: API call failed");
    const note = (await res.json()) as ApiNote;
    return toKitNote(note, data.parentId);
  };

  const remove = async (shortId: string): Promise<void> => {
    assertActive(ctx);
    const res = await apiClient[":id"].notes[":noteId"].$delete({
      param: { id: ctx.notebookId, noteId: shortId },
    });
    if (!res.ok) throw new Error("nb.remove: API call failed");
  };

  return { list, get, search, searchTags, create, update, remove };
};
