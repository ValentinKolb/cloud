import { solidPage } from "@k2b/fibel/solid";
import overviewMarkdown from "./context/overview.md" with { type: "text" };
import { fibelHtml } from "../ssr";
import { uiCatalogEntries } from "./catalog";
import { UiCatalogOverview, UiComponentShowcase } from "./UiCatalogPage";

export const uiPages = [
  solidPage({
    html: fibelHtml,
    path: "/",
    title: "Cloud UI",
    navTitle: "Overview",
    description: "Live components and the contracts Cloud applications share.",
    section: "Start",
    order: 1,
    layout: "full",
    context: overviewMarkdown,
    component: ({ context, page }) => (
      <UiCatalogOverview
        title={page.meta.title}
        documentation={context.html}
        locale={page.locale.code}
      />
    ),
  }),
  ...uiCatalogEntries.map((entry) =>
    solidPage({
      html: fibelHtml,
      path: `/${entry.section}/${entry.page.slug}`,
      title: entry.page.title,
      description: entry.page.summary,
      section: entry.sectionTitle,
      order: entry.order,
      layout: "full",
      context: entry.context,
      component: ({ context, page }) => (
        <UiComponentShowcase
          title={page.meta.title}
          description={page.meta.description}
          documentation={context.html}
          section={entry.section}
          slug={entry.page.slug}
        />
      ),
    }),
  ),
];
