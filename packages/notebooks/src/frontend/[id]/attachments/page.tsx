/**
 * Notebook attachments overview page — `/app/notebooks/<id>/attachments`.
 *
 * Path-based (NOT a `?mode=` query) so the URL stays clean and deep-linkable.
 * Search + pagination via SSR — the SearchBar submits to the same URL with
 * `?search=` set, and the page handler re-renders the filtered grid. KISS:
 * no client-side filter, results stay deterministic.
 */

import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import { Pagination } from "@valentinkolb/cloud/ui";
import { expectUserBackedActor } from "@/actor";
import { notebooksService } from "@/service";
import { ssr } from "../../../config";
import { buildAttachmentsUrl } from "../../params";
import AttachmentsOverview from "../_components/attachments-overview/AttachmentsOverview.island";
import { parseSettings } from "../_components/settings/NotebookSettingsStore";
import NotebookSidebar from "../_components/sidebar/NotebookSidebar.island";
import type { NotebookContext } from "../_components/sidebar/types";

const PER_PAGE = 200;

const parsePage = (raw: string | undefined): number => {
  const n = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
};

export default ssr<AuthContext>(async (c) => {
  const user = expectUserBackedActor(c);
  // Route param accepts either UUID or short-id — same boundary trick
  // as `[id]/page.tsx`. Local `notebookId` holds the canonical UUID.
  const idOrShort = c.req.param("id")!;
  const search = (c.req.query("search") ?? "").trim();
  const page = parsePage(c.req.query("page"));

  const notebook = await notebooksService.notebook.getByIdOrShortId({ idOrShortId: idOrShort });
  if (!notebook) {
    return () => (
      <Layout c={c} title="Not Found">
        <div class="max-w-md mx-auto mt-16">
          <div class="paper p-8 flex items-center justify-center text-dimmed text-xs gap-2">
            <i class="ti ti-alert-circle text-sm" />
            Notebook not found
          </div>
        </div>
      </Layout>
    );
  }
  const notebookId = notebook.id;

  const permission = await notebooksService.notebook.permission.get({
    notebookId,
    userId: user.id,
    userGroups: user.memberofGroupIds,
  });
  if (permission === "none") {
    return () => (
      <Layout c={c} title="Access Denied">
        <div class="max-w-md mx-auto mt-16">
          <div class="paper p-8 flex items-center justify-center text-dimmed text-xs gap-2">
            <i class="ti ti-lock text-sm" />
            You don't have access to this notebook
          </div>
        </div>
      </Layout>
    );
  }

  const cookieHeader = c.req.header("Cookie");
  const settings = parseSettings(cookieHeader, notebook.shortId);

  // Three queries in parallel:
  //   1. Note tree for the sidebar
  //   2. Filtered + paginated attachments for the grid (current page only)
  //   3. Unfiltered total count for the sidebar's "Attachments" badge —
  //      independent of the active search so the badge always reflects
  //      the notebook's actual size, not the current view.
  const [tree, paginatedResult, totalAttachmentCount, tags, favoriteRows] = await Promise.all([
    notebooksService.note.getTree({ notebookId }),
    notebooksService.attachment.listPaginated({
      notebookId,
      pagination: { page, perPage: PER_PAGE },
      filter: { query: search || undefined },
    }),
    notebooksService.attachment.count({ notebookId }),
    notebooksService.tag.listForNotebook({ notebookId }),
    notebooksService.note.favorites.listIds({ notebookId, userId: user.id }),
  ]);
  const tagCount = tags.length;

  const totalPages = Math.max(1, Math.ceil(paginatedResult.total / paginatedResult.perPage));
  const baseHref = buildAttachmentsUrl(notebook.shortId);
  const paginationBaseUrl = search ? `${baseHref}?search=${encodeURIComponent(search)}&page=` : `${baseHref}?page=`;

  const ctx: NotebookContext = {
    notebook,
    tree,
    selectedNoteId: null,
    userId: user.id,
    settings,
    permission,
    attachmentCount: totalAttachmentCount,
    tagCount,
    favoriteNoteIds: favoriteRows.map((row) => row.noteId),
    tags,
  };

  return () => (
    <Layout
      c={c}
      fullPage
      title={[
        { title: "Start", href: "/" },
        { title: "Notebooks", href: "/app/notebooks" },
        { title: notebook.name, href: `/app/notebooks/${notebook.shortId}` },
        { title: "Attachments" },
      ]}
    >
      <div class="app-cols flex-1 min-h-0">
        <NotebookSidebar ctx={ctx} />
        <div class="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
          {/* Search bar across the full content width. The breadcrumb already
              labels the page — no additional title above. */}
          <SearchBar value={search} action={baseHref} placeholder="Search attachments…" ariaLabel="Search attachments" />

          <div class="mt-2 flex-1 min-h-0 overflow-y-auto flex flex-col gap-2">
            <AttachmentsOverview notebookId={notebook.shortId} initial={paginatedResult.items} searchQuery={search} />
            <Pagination currentPage={paginatedResult.page} totalPages={totalPages} baseUrl={paginationBaseUrl} />
          </div>
        </div>
      </div>
    </Layout>
  );
});
