import { For } from "solid-js";
import { uiCatalogEntries, uiCatalogSections } from "./catalog";
import ActionsCatalogDemo from "./ActionsCatalogDemo.island";
import ContentCatalogDemo from "./ContentCatalogDemo.island";
import FeedbackCatalogDemo from "./FeedbackCatalogDemo.island";
import InputCatalogDemo from "./InputCatalogDemo.island";
import LayoutCatalogDemo from "./LayoutCatalogDemo.island";
import SurfacesCatalogDemo from "./SurfacesCatalogDemo.island";
import WidgetsCatalogDemo from "./WidgetsCatalogDemo.island";

type DocumentationProps = {
  documentation: string;
  title: string;
};

type ComponentShowcaseProps = DocumentationProps & {
  description: string;
  section: string;
  slug: string;
};

const sectionDescriptions: Record<string, string> = {
  input: "Fields, editors, pickers, uploads, and filters.",
  actions: "Buttons, menus, and focused action controls.",
  layout: "Application shells, panes, dialogs, settings, and navigation.",
  surfaces: "Cards, statistics, operational panels, and calendars.",
  feedback: "Messages, statuses, toasts, tooltips, and prompts.",
  content: "Tables, charts, files, media, code, and rich content.",
  widgets: "Endpoint-driven blocks for application dashboards.",
};

function CatalogDemo(props: { section: string; slug: string }) {
  switch (props.section) {
    case "input":
      return <InputCatalogDemo slug={props.slug} />;
    case "actions":
      return <ActionsCatalogDemo slug={props.slug} />;
    case "layout":
      return <LayoutCatalogDemo slug={props.slug} />;
    case "surfaces":
      return <SurfacesCatalogDemo slug={props.slug} />;
    case "feedback":
      return <FeedbackCatalogDemo slug={props.slug} />;
    case "content":
      return <ContentCatalogDemo slug={props.slug} />;
    case "widgets":
      return <WidgetsCatalogDemo slug={props.slug} />;
    default:
      return <p class="ui-demo-missing">No live example is registered for this section.</p>;
  }
}

function ComponentShowcase(props: ComponentShowcaseProps) {
  return (
    <article class="ui-showcase ui-reference-showcase">
      <header class="ui-reference-heading">
        <div class="ui-page-heading">
          <p>@valentinkolb/cloud/ui</p>
          <h1>{props.title}</h1>
        </div>
        <p>{props.description}</p>
      </header>
      <section class="ui-reference-playground" aria-label="Live component example">
        <CatalogDemo section={props.section} slug={props.slug} />
      </section>
      <section class="ui-reference-body" aria-label="Component reference">
        <div class="ui-documentation fibel-prose" innerHTML={props.documentation} />
      </section>
    </article>
  );
}

export function UiCatalogOverview(props: DocumentationProps & { locale: string }) {
  return (
    <article class="ui-overview">
      <header class="ui-overview-header">
        <div class="ui-page-heading">
          <p>@valentinkolb/cloud/ui</p>
          <h1>Shared components for Cloud applications.</h1>
        </div>
        <div class="ui-overview-intro">
          <p>
            Choose a component by task. Every page shows the running component,
            its public import, and the rules its parent must follow.
          </p>
          <dl>
            <div>
              <dt>pages</dt>
              <dd>{String(uiCatalogEntries.length).padStart(2, "0")}</dd>
            </div>
            <div>
              <dt>sections</dt>
              <dd>{String(uiCatalogSections.length).padStart(2, "0")}</dd>
            </div>
          </dl>
        </div>
      </header>

      <nav class="ui-catalog-directory" aria-label="Component catalog">
        <For each={uiCatalogSections}>
          {(section) => {
            const entries = uiCatalogEntries.filter((entry) => entry.section === section.id);
            return (
              <section class="ui-catalog-section">
                <header>
                  <div>
                    <h2>{section.title}</h2>
                    <p>{sectionDescriptions[section.id]}</p>
                  </div>
                  <span>{String(section.count).padStart(2, "0")}</span>
                </header>
                <ul>
                  <For each={entries}>
                    {(entry) => (
                      <li>
                        <a href={`/ui/${props.locale}/${entry.id}`}>
                          <span>{entry.page.title}</span>
                          <i class={entry.page.icon} aria-hidden="true" />
                        </a>
                      </li>
                    )}
                  </For>
                </ul>
              </section>
            );
          }}
        </For>
      </nav>
    </article>
  );
}

export function UiComponentShowcase(
  props: DocumentationProps & {
    description: string;
    section: string;
    slug: string;
  },
) {
  return (
    <ComponentShowcase
      documentation={props.documentation}
      title={props.title}
      description={props.description}
      section={props.section}
      slug={props.slug}
    />
  );
}
