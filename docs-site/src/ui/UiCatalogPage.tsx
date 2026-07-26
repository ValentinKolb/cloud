import { PanelHeader, StatCell, StatGrid, StatusBadge } from "@valentinkolb/cloud/ui";
import type { JSX } from "solid-js";
import { Show } from "solid-js";
import SiteHeader from "../components/SiteHeader";
import ComponentNavigation from "./ComponentNavigation.client";

const panelHeaderCode = `import { PanelHeader } from "@valentinkolb/cloud/ui";

<PanelHeader
  title="Applications"
  subtitle="17 connected services"
  actions={<a class="btn-input btn-input-sm" href="/apps">Open registry</a>}
/>`;

const badgeCode = `import { StatusBadge } from "@valentinkolb/cloud/ui";

<StatusBadge tone="ok" label="Online" />
<StatusBadge tone="degraded" label="Degraded" />
<StatusBadge tone="running" label="Deploying" />`;

const statsCode = `import { StatCell, StatGrid } from "@valentinkolb/cloud/ui";

<StatGrid columns={3}>
  <StatCell label="Applications" value={17} sub="all healthy" />
  <StatCell label="Routes" value={106} sub="HTTP and WebSocket" />
  <StatCell label="Jobs" value={42} sub="last 24 hours" />
</StatGrid>`;

type ExampleProps = {
  id: string;
  name: string;
  source: string;
  summary: string;
  guidance: string;
  code: string;
  children: JSX.Element;
};

function Example(props: ExampleProps) {
  return (
    <section class="ui-example" id={props.id}>
      <div class="ui-example-copy">
        <p class="ui-kicker">{props.source}</p>
        <h2>{props.name}</h2>
        <p>{props.summary}</p>
        <p class="ui-guidance">
          <b>Use when</b> {props.guidance}
        </p>
      </div>
      <div class="ui-example-demo">
        <div class="ui-preview">{props.children}</div>
        <pre class="ui-code">
          <code>{props.code}</code>
        </pre>
      </div>
    </section>
  );
}

export type CatalogComponent = "panel-header" | "status-badge" | "stat-grid";

type UiCatalogPageProps = {
  focus?: CatalogComponent;
};

const componentName = (component: CatalogComponent) =>
  ({ "panel-header": "PanelHeader", "status-badge": "StatusBadge", "stat-grid": "StatGrid" })[component];

export default function UiCatalogPage(props: UiCatalogPageProps) {
  return (
    <>
      <SiteHeader active="ui" />
      <div class="ui-layout">
        <aside class="fibel-sidebar ui-sidebar overflow-y-auto border-r border-zinc-200 bg-white p-5 pt-6 dark:border-white/10 dark:bg-zinc-950 lg:sticky lg:top-16 lg:h-[calc(100vh-4rem)] lg:pt-9">
          <ComponentNavigation active={props.focus} />
        </aside>
        <main class="ui-catalog">
          <header class="ui-intro">
            <div>
              <p class="ui-kicker">Cloud UI · live source</p>
              <h1>{props.focus ? componentName(props.focus) : "The UI primitives Cloud applications are built from."}</h1>
            </div>
            <p>
              Every example imports the component from <code>@valentinkolb/cloud/ui</code>. Use this catalog to choose a
              primitive, inspect its states, and prototype package changes against the real implementation.
            </p>
          </header>

          <Show when={!props.focus || props.focus === "panel-header"}>
            <Example
              id="panel-header"
              name="PanelHeader"
              source="@valentinkolb/cloud/ui"
              summary="A consistent title, context, and action row for application and operations panels."
              guidance="a bounded surface needs a heading and optional action without inventing another layout."
              code={panelHeaderCode}
            >
              <div class="paper p-4">
                <PanelHeader
                  title="Applications"
                  subtitle="17 connected services"
                  actions={<a class="btn-input btn-input-sm" href="/ui/panel-header">Open registry</a>}
                />
              </div>
            </Example>
          </Show>

          <Show when={!props.focus || props.focus === "status-badge"}>
            <Example
              id="status-badge"
              name="StatusBadge"
              source="@valentinkolb/cloud/ui"
              summary="One semantic vocabulary for health and runtime state across applications."
              guidance="a status needs a stable tone while the domain supplies its own wording."
              code={badgeCode}
            >
              <div class="flex flex-wrap items-center gap-2">
                <StatusBadge tone="ok" label="Online" />
                <StatusBadge tone="degraded" label="Degraded" />
                <StatusBadge tone="error" label="Failed" />
                <StatusBadge tone="running" label="Deploying" />
                <StatusBadge tone="neutral" label="Disabled" variant="text" />
              </div>
            </Example>
          </Show>

          <Show when={!props.focus || props.focus === "stat-grid"}>
            <Example
              id="stat-grid"
              name="StatGrid"
              source="@valentinkolb/cloud/ui"
              summary="A compound layout for comparable operational numbers, with consistent dividers and responsive columns."
              guidance="a small group of headline values belongs together and each value has a reproducible scope."
              code={statsCode}
            >
              <StatGrid columns={3}>
                <StatCell label="Applications" value={17} sub="all healthy" />
                <StatCell label="Routes" value={106} sub="HTTP and WebSocket" />
                <StatCell label="Jobs" value={42} sub="last 24 hours" />
              </StatGrid>
            </Example>
          </Show>
        </main>
      </div>
    </>
  );
}
