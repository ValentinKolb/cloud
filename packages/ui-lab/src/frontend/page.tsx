import { ssr } from "../config";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { markdown } from "@valentinkolb/cloud/shared";
import { Layout } from "@valentinkolb/cloud/ssr";
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

export default ssr<AuthContext>(async (c) => () => (
  <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "UI Lab" }]}>
    <div class="h-full overflow-y-auto">
      <UiLabShowcase markdownHtml={markdownPreview} />
    </div>
  </Layout>
));
