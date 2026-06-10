import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { expectUserBackedActor } from "@/actor";
import { notebooksService } from "@/service";
import { ssr } from "../config";
import { parseLastNotebookId } from "./[id]/_components/settings/NotebookSettingsStore";
import NotebooksOverview from "./NotebooksOverview.island";

/**
 * Notebooks list page - shows all notebooks the user has access to
 */
export default ssr<AuthContext>(async (c) => {
  const user = expectUserBackedActor(c);
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
      <NotebooksOverview notebooks={notebooks} templates={templates} initialQuery={initialQuery} />
    </Layout>
  );
});
