import { solidPage } from "@k2b/fibel/solid";
import gettingStartedMarkdown from "./context/getting-started.md" with { type: "text" };
import overviewMarkdown from "./context/overview.md" with { type: "text" };
import { fibelHtml } from "../ssr";
import { uiCatalogEntries } from "./catalog";
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
    context: overviewMarkdown,
    component: ({ context, page }) => (
      <UiCatalogOverview
        title={page.meta.title}
        documentation={context.html}
        locale={page.locale.code}
      />
    ),
  }),
  solidPage({
    html: fibelHtml,
    collection: "ui",
    path: "/getting-started",
    title: "Getting started",
    navTitle: "Getting started",
    description: "Install, scope, theme, and render @k2b/ui in any Solid and @k2b/ssr project.",
    section: "Start",
    order: 2,
    layout: "full",
    context: gettingStartedMarkdown,
    component: ({ context, page }) => (
      <article class="ui-showcase ui-reference-showcase">
        <header class="ui-reference-heading">
          <div class="ui-page-heading">
            <p>@k2b/ui</p>
            <h1>{page.meta.title}</h1>
          </div>
          <p>{page.meta.description}</p>
        </header>
        <section class="ui-reference-body" aria-label="Getting started guide">
          <div class="ui-documentation fibel-prose" innerHTML={context.html} />
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
      context: entry.context,
      component: ({ context, page }) => (
        <UiComponentShowcase
          title={page.meta.title}
          description={page.meta.description}
          documentation={context.html}
          packageName={entry.packageName}
          section={entry.section}
          slug={entry.page.slug}
        />
      ),
    }),
  ),
];
