import { ssr } from "@valentinkolb/cloud/core/config";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { markdown } from "@valentinkolb/cloud/lib/shared";
import { Layout } from "@valentinkolb/cloud/core/ssr";
import UiLabShowcase from "./UiLabShowcase.island";

const markdownPreview = markdown.render(
  [
    "## UI Lab Markdown",
    "",
    "This page is a static visual showcase for shared UI building blocks.",
    "",
    "- Input components",
    "- Navigation/cards",
    "- Feedback elements",
  ].join("\n"),
);

export default ssr<AuthContext>(async (c) => {
  return (
    <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "UI Lab" }]}>
      <div class="h-full overflow-y-auto">
        <UiLabShowcase markdownHtml={markdownPreview} />
      </div>
    </Layout>
  );
});
