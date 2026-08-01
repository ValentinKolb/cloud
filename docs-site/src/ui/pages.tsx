import { solidPage } from "@k2b/fibel/solid";
import { fibelHtml } from "../ssr";
import { uiCatalogEntries } from "./catalog";
import gettingStartedMarkdown from "./context/getting-started.md" with { type: "text" };
import overviewMarkdown from "./context/overview.md" with { type: "text" };
import { UiCatalogOverview, UiComponentShowcase } from "./UiCatalogPage";

export const uiPages = [
  solidPage({
    html: fibelHtml,
    collection: "ui",
    path: "/",
    title: "UI components",
    navTitle: "Overview",
    description: "Portable @k2b/ui components and the integrations that intentionally remain Cloud-specific.",
    section: "Start",
    order: 1,
    layout: "full",
    content: overviewMarkdown,
    component: ({ content, page }) => <UiCatalogOverview title={page.meta.title} documentation={content.html} locale={page.locale.code} />,
  }),
  solidPage({
    html: fibelHtml,
    collection: "ui",
    path: "/getting-started",
    title: "Getting started",
    navTitle: "Getting started",
    description: "Install @k2b/ui, load its scoped styles, customize the theme, and use it with Solid SSR.",
    section: "Start",
    order: 2,
    layout: "full",
    content: gettingStartedMarkdown,
    component: ({ content, page }) => (
      <article class="ui-showcase ui-reference-showcase">
        <header class="ui-reference-heading">
          <div class="ui-page-heading">
            <p>@k2b/ui</p>
            <h1>{page.meta.title}</h1>
          </div>
          <p>{page.meta.description}</p>
        </header>
        <section class="ui-reference-body" aria-label="Getting started guide">
          <div class="ui-documentation fibel-prose" innerHTML={content.html} />
        </section>
      </article>
    ),
  }),
  ...uiCatalogEntries.map((entry) =>
    solidPage({
      html: fibelHtml,
      collection: "ui",
      path: `/${entry.section}/${entry.page.slug}`,
      title: entry.page.title,
      description: entry.page.summary,
      section: entry.sectionTitle,
      order: entry.order,
      layout: "full",
      content: entry.context,
      component: ({ content, page }) => (
        <UiComponentShowcase
          title={page.meta.title}
          description={page.meta.description}
          documentation={content.html}
          packageName={entry.packageName}
          section={entry.section}
          slug={entry.page.slug}
        />
      ),
    }),
  ),
];
