import { ssr } from "../config";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { notebooksService } from "@/service";
import { Layout } from "@valentinkolb/cloud/ssr";
import { parseLastNotebookId } from "./[id]/_components/settings/NotebookSettingsStore";
import NotebooksOverview from "./NotebooksOverview.island";

/**
 * Notebooks list page - shows all notebooks the user has access to
 */
export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const url = new URL(c.req.raw.url);
  const initialQuery = url.searchParams.get("q")?.trim() ?? "";

  const notebookPage = await notebooksService.notebook.list({
    userId: user.id,
    groups: user.memberofGroupIds,
  });
  const notebooks = notebookPage.items;

  // Redirect to last opened notebook if ?recent=true
  if (url.searchParams.get("recent") === "true" && notebooks.length > 0) {
    const cookieHeader = c.req.raw.headers.get("Cookie") ?? undefined;
    const lastId = parseLastNotebookId(cookieHeader);
    if (lastId && notebooks.some((n) => n.id === lastId || n.shortId === lastId)) {
      return c.redirect(`/app/notebooks/${lastId}`);
    }
  }
  const templates = notebooksService.template.list();

  return () => (
    <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "Notebooks" }]}>
      <div class="max-w-6xl mx-auto p-3 sm:p-4">
        <header class="mb-5">
          <div class="flex items-center gap-3">
            <div class="w-11 h-11 thumbnail bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0">
              <i class="ti ti-note text-xl text-zinc-600 dark:text-zinc-400" />
            </div>
            <div class="min-w-0">
              <h1 class="text-xl font-semibold text-primary">Notebooks</h1>
              <p class="text-sm text-dimmed">Collaborative notes, linked knowledge, scripts, and reusable workspaces.</p>
            </div>
          </div>
        </header>

        <NotebooksOverview notebooks={notebooks} templates={templates} initialQuery={initialQuery} />
      </div>
    </Layout>
  );
});
