/**
 * Notebook attachments overview page — `/app/notebooks/<id>/attachments`.
 *
 * Path-based (NOT a `?mode=` query) so the URL stays clean and deep-linkable.
 * Search + pagination via SSR — the SearchBar submits to the same URL with
 * `?search=` set, and the page handler re-renders the filtered grid. KISS:
 * no client-side filter, results stay deterministic.
 */
import { ssr } from "../../../config";
import { Layout } from "@valentinkolb/cloud/ssr";
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { Pagination } from "@valentinkolb/cloud/ui";
import { notebooksService } from "@/service";
import AttachmentsOverview from "../_components/attachments-overview/AttachmentsOverview.island";
import { parseSettings } from "../_components/settings/NotebookSettingsStore";
import NotebookSidebar from "../_components/sidebar/NotebookSidebar";
import type { NotebookContext } from "../_components/sidebar/types";
import { buildAttachmentsUrl } from "../../params";

const PER_PAGE = 200;

const parsePage = (raw: string | undefined): number => {
  const n = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
};

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const notebookId = c.req.param("id");
  const search = (c.req.query("search") ?? "").trim();
  const page = parsePage(c.req.query("page"));

  const notebook = await notebooksService.notebook.get({ id: notebookId });
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
  const settings = parseSettings(cookieHeader, notebookId);

  // Three queries in parallel:
  //   1. Note tree for the sidebar
  //   2. Filtered + paginated attachments for the grid (current page only)
  //   3. Unfiltered total count for the sidebar's "Attachments" badge —
  //      independent of the active search so the badge always reflects
  //      the notebook's actual size, not the current view.
  const [tree, paginatedResult, totalAttachmentCount] = await Promise.all([
    notebooksService.note.getTree({ notebookId }),
    notebooksService.attachment.listPaginated({
      notebookId,
      pagination: { page, perPage: PER_PAGE },
      filter: { query: search || undefined },
    }),
    notebooksService.attachment.count({ notebookId }),
  ]);

  const totalPages = Math.max(
    1,
    Math.ceil(paginatedResult.total / paginatedResult.perPage)
  );
  const baseHref = buildAttachmentsUrl(notebookId);
  const paginationBaseUrl = search
    ? `${baseHref}?search=${encodeURIComponent(search)}&page=`
    : `${baseHref}?page=`;

  const ctx: NotebookContext = {
    notebook,
    tree,
    selectedNoteId: null,
    settings,
    permission,
    viewMode: "edit",
    attachmentCount: totalAttachmentCount,
  };

  return () => (
    <Layout
      c={c}
      fullPage
      title={[
        { title: "Start", href: "/" },
        { title: "Notebooks", href: "/app/notebooks" },
        { title: notebook.name, href: `/app/notebooks/${notebook.id}` },
        { title: "Attachments" },
      ]}
    >
      <div class="app-cols flex-1 min-h-0">
        <NotebookSidebar ctx={ctx} />
        <div class="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
          {/* Search bar across the full content width. The breadcrumb already
              labels the page — no additional title above. */}
          <SearchBar
            value={search}
            action={baseHref}
            placeholder="Search attachments…"
            ariaLabel="Search attachments"
          />

          <div class="mt-2 flex-1 min-h-0 overflow-y-auto flex flex-col gap-2">
            <AttachmentsOverview
              notebookId={notebookId}
              initial={paginatedResult.items}
              searchQuery={search}
            />
            <Pagination
              currentPage={paginatedResult.page}
              totalPages={totalPages}
              baseUrl={paginationBaseUrl}
            />
          </div>
        </div>
      </div>
    </Layout>
  );
});
