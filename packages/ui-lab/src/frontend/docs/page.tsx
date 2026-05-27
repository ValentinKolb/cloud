import { ssr } from "../../config";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { markdown } from "@valentinkolb/cloud/shared";
import { Layout } from "@valentinkolb/cloud/ssr";
import { findDocPage } from "./registry";
import UiLabDocs from "./UiLabDocs.island";

const markdownPreview = markdown.render(
  [
    "## Welcome to the UI Lab",
    "",
    "Markdown is rendered **server-side** via `@valentinkolb/cloud/shared`'s `markdown.render`. The result is sanitised HTML that the island can drop straight into a `<MarkdownView>`.",
    "",
    "- Tables, info blocks, task lists and code fences are all supported",
    "- Mermaid diagrams hydrate client-side",
    "- KaTeX math and Tabler icons render inline",
    "",
    "> A useful tip: if you need an editor instead of a read-only view, use `<TextInput markdown />` or `<MarkdownEditor />` from the Inputs and Content pages.",
  ].join("\n"),
);

export default ssr<AuthContext>(async (c) => {
  const section = c.req.param("section");
  const slug = c.req.param("slug");
  const current = findDocPage(section, slug);

  if (!current) {
    return () => (
      <Layout c={c} fullPage title={[{ title: "Start", href: "/" }, { title: "UI Lab", href: "/app/ui-lab" }, { title: "Not Found" }]}>
        <div class="flex flex-1 items-center justify-center">
          <div class="paper flex max-w-md flex-col items-center gap-2 p-8 text-center text-xs text-dimmed">
            <i class="ti ti-alert-circle text-2xl" />
            <p>UI Lab page not found.</p>
          </div>
        </div>
      </Layout>
    );
  }

  return () => (
    <Layout c={c} fullPage title={[{ title: "Start", href: "/" }, { title: "UI Lab", href: "/app/ui-lab" }, { title: current.title }]}>
      <UiLabDocs section={current.section} slug={current.slug} markdownHtml={markdownPreview} />
    </Layout>
  );
});
