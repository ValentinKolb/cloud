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
import { extractTags } from "../tag-extract";
import type { KitContext, KitNote, KitNotesAPI, KitQuery } from "./kit-types";

const assertActive = (ctx: KitContext): void => {
  if (ctx.isActive && !ctx.isActive()) {
    throw new Error("Script run is no longer active");
  }
};

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

const toKitNote = (n: ApiNote): KitNote => {
  let tags: string[] | undefined;
  return {
    id: n.shortId,
    title: n.title,
    content: n.contentMd,
    get tags() {
      tags ??= extractTags(n.contentMd);
      return tags;
    },
    parentId: n.parentId,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    lockedAt: n.lockedAt,
  };
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
 *  they seeked into the middle of a page. */
const fetchPagesUpTo = async (
  notebookId: string,
  maxItems: number,
  searchQuery?: string,
  startPage = 1,
): Promise<KitNote[]> => {
  const out: KitNote[] = [];
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
    if (!res.ok) throw new Error("kit.notes: API call failed");
    const payload = (await res.json()) as { data: ApiNote[]; pagination?: { total?: number } };
    if (payload.data.length === 0) break;
    for (const n of payload.data) out.push(toKitNote(n));
    if (payload.data.length < API_PER_PAGE_MAX) break; // last page
    page++;
  }
  return out;
};

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
    // Walk every page so callers see the full notebook, not just
    // the first 100. Capped at SEARCH_FETCH_CAP to avoid runaway
    // fetches; document if anyone needs more.
    return fetchPagesUpTo(ctx.notebookId, SEARCH_FETCH_CAP);
  };

  const get = async (shortId: string): Promise<KitNote | null> => {
    const res = await apiClient[":id"].notes[":noteId"].$get({
      param: { id: ctx.notebookId, noteId: shortId },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("kit.notes.get: API call failed");
    const note = (await res.json()) as ApiNote;
    // The API endpoint already enforces notebook membership via
    // `requireNoteInNotebook` — a 404 above covers cross-notebook
    // ids. Don't re-check on the client: `note.notebookId` is the
    // canonical UUID and `ctx.notebookId` is the short-id, so a
    // local comparison would always reject (codex review on
    // commit 7ee5fdc, finding 2).
    return toKitNote(note);
  };

  const search = async (query: string | KitQuery): Promise<KitNote[]> => {
    // Normalise: string overload becomes `{ search: <string> }`.
    const q: KitQuery = typeof query === "string" ? { search: query } : query;
    const userLimit = Math.max(0, Math.min(q.limit ?? 50, 200));
    const userOffset = Math.max(0, q.offset ?? 0);

    const hasPostFilter =
      (q.tags && q.tags.length > 0) ||
      q.createdAfter !== undefined ||
      q.createdBefore !== undefined ||
      q.updatedAfter !== undefined ||
      q.updatedBefore !== undefined;

    if (!hasPostFilter) {
      // Fast path: API can answer this query natively. Seek to the
      // API page containing `userOffset` rather than re-fetching
      // every prior page (codex review on commit 40ee626: offset
      // pagination must stay O(limit), not O(offset)). Within-
      // page slice handles the residual when `userOffset` falls
      // mid-page.
      const startPage = Math.floor(userOffset / API_PER_PAGE_MAX) + 1;
      const withinPageOffset = userOffset % API_PER_PAGE_MAX;
      const needed = withinPageOffset + userLimit;
      const slice = await fetchPagesUpTo(ctx.notebookId, needed, q.search, startPage);
      return slice.slice(withinPageOffset, withinPageOffset + userLimit);
    }

    // Slow path: tags / date filters aren't server-side, so we
    // have to fetch, filter, then paginate client-side. Walk the
    // pages until exhausted or until the safety cap.
    const all = await fetchPagesUpTo(ctx.notebookId, SEARCH_FETCH_CAP, q.search);
    const filtered = postFilter(all, q);
    return filtered.slice(userOffset, userOffset + userLimit);
  };

  const create = async (data: { title: string; parentId?: string }): Promise<KitNote> => {
    assertActive(ctx);
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
    assertActive(ctx);
    const res = await apiClient[":id"].notes[":noteId"].$patch({
      param: { id: ctx.notebookId, noteId: shortId },
      json: data,
    });
    if (!res.ok) throw new Error("kit.notes.update: API call failed");
    const note = (await res.json()) as ApiNote;
    return toKitNote(note);
  };

  const remove = async (shortId: string): Promise<void> => {
    assertActive(ctx);
    const res = await apiClient[":id"].notes[":noteId"].$delete({
      param: { id: ctx.notebookId, noteId: shortId },
    });
    if (!res.ok) throw new Error("kit.notes.remove: API call failed");
  };

  return { list, get, search, create, update, remove };
};
