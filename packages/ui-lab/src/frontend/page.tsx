import { ssr } from "../config";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { markdown } from "@valentinkolb/cloud/shared";
import { Layout } from "@valentinkolb/cloud/ssr";
import UiLab from "./UiLab.island";

// Pre-render a rich markdown sample server-side. We can't run the
// markdown renderer in the browser (it needs sanitize-html), so we
// hand the HTML to the island as a prop.
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
    "> A useful tip: if you need an editor instead of a read-only view, use `<TextInput markdown />` or `<MarkdownEditor />` from the Inputs and Content tabs.",
  ].join("\n"),
);

export default ssr<AuthContext>(async (c) => () => (
  <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "UI Lab" }]}>
    <div class="h-full overflow-y-auto">
      <UiLab markdownHtml={markdownPreview} />
    </div>
  </Layout>
));
