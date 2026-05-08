/**
 * Per-tag notes page — `/app/notebooks/<id>/tags/<tag>`.
 *
 * Lists every note that references `#<tag>`, with previews + a SSR
 * search bar. Search filter mirrors the attachments overview pattern:
 * the `SearchBar` submits to the same URL with `?search=`, the page
 * handler re-renders, no client-side filtering.
 */
import { ssr } from "../../../../config";
import { Layout } from "@valentinkolb/cloud/ssr";
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { Pagination } from "@valentinkolb/cloud/ui";
import { notebooksService } from "@/service";
import { parseSettings } from "../../_components/settings/NotebookSettingsStore";
import NotebookSidebar from "../../_components/sidebar/NotebookSidebar";
import type { NotebookContext } from "../../_components/sidebar/types";
import { buildNoteUrl, buildTagPageUrl } from "../../../params";

const PER_PAGE = 50;

const parsePage = (raw: string | undefined): number => {
  const n = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
};

const formatDate = (iso: string): string => new Date(iso).toLocaleDateString();

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  // Route param accepts either UUID or short-id — resolved to canonical
  // UUID via `getByIdOrShortId`. The local `notebookId` variable below
  // holds the UUID; `notebook.shortId` is what we hand to URL builders.
  const idOrShort = c.req.param("id");
  const tagParam = (c.req.param("tag") ?? "").toLowerCase();
  const search = (c.req.query("search") ?? "").trim();
  const page = parsePage(c.req.query("page"));

  const notebook = await notebooksService.notebook.getByIdOrShortId({ idOrShortId: idOrShort });
  const notebookId = notebook?.id;
  if (!notebook || !notebookId) {
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

  // Four parallel queries:
  //   1. Note tree for sidebar
  //   2. Page of notes-with-tag (filtered by ?search if any)
  //   3. Total notes-with-tag (unfiltered) for the header counter
  //   4. Sidebar badge counts
  const [tree, paginatedResult, totalNotesForTag, attachmentCount, tagCount] = await Promise.all([
    notebooksService.note.getTree({ notebookId }),
    notebooksService.tag.listNotesForTag({
      notebookId,
      tag: tagParam,
      search: search || undefined,
      pagination: { limit: PER_PAGE, offset: (page - 1) * PER_PAGE },
    }),
    notebooksService.tag.countNotesForTag({ notebookId, tag: tagParam }),
    notebooksService.attachment.count({ notebookId }),
    notebooksService.tag.count({ notebookId }),
  ]);

  const totalPages = Math.max(1, Math.ceil(paginatedResult.total / PER_PAGE));
  const baseHref = buildTagPageUrl(notebook.shortId, tagParam);
  const paginationBaseUrl = search ? `${baseHref}?search=${encodeURIComponent(search)}&page=` : `${baseHref}?page=`;

  const ctx: NotebookContext = {
    notebook,
    tree,
    selectedNoteId: null,
    settings,
    permission,
    viewMode: "edit",
    attachmentCount,
    tagCount,
  };

  return () => (
    <Layout
      c={c}
      fullPage
      title={[
        { title: "Start", href: "/" },
        { title: "Notebooks", href: "/app/notebooks" },
        { title: notebook.name, href: `/app/notebooks/${notebook.shortId}` },
        { title: `#${tagParam}` },
      ]}
    >
      <div class="app-cols flex-1 min-h-0">
        <NotebookSidebar ctx={ctx} />
        <div class="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
          {/* SearchBar (full width) + note counter on the right. The
              tag itself already lives in the breadcrumb above. */}
          <div class="flex items-center gap-2">
            <div class="flex-1 min-w-0">
              <SearchBar
                value={search}
                action={baseHref}
                placeholder={`Search in #${tagParam}…`}
                ariaLabel={`Search notes tagged ${tagParam}`}
              />
            </div>
            <span class="shrink-0 text-xs text-dimmed tabular-nums">
              {search ? `${paginatedResult.total} of ${totalNotesForTag}` : `${totalNotesForTag} note${totalNotesForTag === 1 ? "" : "s"}`}
            </span>
          </div>

          <div class="mt-2 flex-1 min-h-0 overflow-y-auto flex flex-col gap-2">
            {paginatedResult.items.length > 0 ? (
              <ul class="paper overflow-hidden divide-y divide-zinc-100 dark:divide-zinc-800">
                {paginatedResult.items.map((n) => (
                  <li>
                    <a
                      href={buildNoteUrl(notebook.shortId, n.shortId)}
                      class="flex flex-col gap-1 px-3 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 no-underline"
                    >
                      <div class="flex items-center gap-2">
                        <i class="ti ti-file-text text-sm shrink-0 text-dimmed" />
                        <span class="flex-1 truncate text-xs text-primary">{n.title}</span>
                        <span class="shrink-0 text-[10px] text-dimmed tabular-nums">{formatDate(n.updatedAt)}</span>
                      </div>
                      {n.preview && (
                        <p class="text-[11px] text-dimmed line-clamp-2 pl-5">{n.preview}</p>
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <div class="paper p-8 flex flex-col items-center justify-center gap-2 text-xs text-dimmed">
                <i class="ti ti-search-off text-2xl" />
                {search ? (
                  <p>No notes tagged #{tagParam} match "{search}".</p>
                ) : totalNotesForTag === 0 ? (
                  <>
                    <p>No notes tagged #{tagParam}.</p>
                    <p>The tag may have been removed since the index was last refreshed.</p>
                  </>
                ) : (
                  <p>No results.</p>
                )}
              </div>
            )}

            <Pagination currentPage={page} totalPages={totalPages} baseUrl={paginationBaseUrl} />
          </div>
        </div>
      </div>
    </Layout>
  );
});
