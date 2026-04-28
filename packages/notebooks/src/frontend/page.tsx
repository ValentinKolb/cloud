import { ssr } from "../config";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { notebooksService } from "@/service";
import { Layout } from "@valentinkolb/cloud/ssr";
import { parseLastNotebookId } from "./[id]/_components/settings/NotebookSettingsStore";
import CreateNotebookButton from "./CreateNotebookButton.island";

/**
 * Notebooks list page - shows all notebooks the user has access to
 */
export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const url = new URL(c.req.raw.url);

  const notebookPage = await notebooksService.notebook.list({
    userId: user.id,
    groups: user.memberofGroupIds,
  });
  const notebooks = notebookPage.items;

  // Redirect to last opened notebook if ?recent=true
  if (url.searchParams.get("recent") === "true" && notebooks.length > 0) {
    const cookieHeader = c.req.raw.headers.get("Cookie") ?? undefined;
    const lastId = parseLastNotebookId(cookieHeader);
    if (lastId && notebooks.some((n) => n.id === lastId)) {
      return c.redirect(`/app/notebooks/${lastId}`);
    }
  }

  return () => (
    <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "Notebooks" }]}>
      <div class="max-w-4xl mx-auto">
        {/* Hero */}
        <div class="p-6 mb-4 text-center">
          <div class="flex items-center justify-center gap-3 mb-2">
            <div class="w-12 h-12 thumbnail bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
              <i class="ti ti-notebook text-2xl text-zinc-600 dark:text-zinc-400" />
            </div>
          </div>
          <h1 class="text-xl font-semibold mb-1">Notebooks</h1>
          <p class="text-sm text-dimmed">Collaborative documents with real-time editing</p>
        </div>

        {/* Info block */}
        <div class="info-block-info mb-6 flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <i class="ti ti-notebook shrink-0" />
            <span>
              {notebooks.length === 0
                ? "No notebooks yet. Create one to get started!"
                : `${notebooks.length} notebook${notebooks.length !== 1 ? "s" : ""} available`}
            </span>
          </div>
          <CreateNotebookButton />
        </div>

        {/* Notebooks grid */}
        {notebooks.length > 0 && (
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {notebooks.map((notebook) => (
              <a
                href={`/app/notebooks/${notebook.id}`}
                class="paper p-4 flex items-center gap-4 hover:paper-highlighted transition-all no-underline"
              >
                <div class="w-10 h-10 thumbnail bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center shrink-0">
                  <i class={`${notebook.icon || "ti ti-notebook"} text-lg text-blue-600 dark:text-blue-400`} />
                </div>
                <div class="flex-1 min-w-0">
                  <span class="text-sm font-semibold text-primary block truncate">{notebook.name}</span>
                  <p class="text-xs text-dimmed truncate">{notebook.description || "No description"}</p>
                </div>
                <i class="ti ti-chevron-right text-dimmed" />
              </a>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
});
