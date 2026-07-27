import { type JSX, Show } from "solid-js";
import Placeholder from "../surfaces/Placeholder";
import { PanelHeader } from "./PanelHeader";

export type AppOverviewProps = {
  title: string;
  subtitle?: JSX.Element;
  icon?: string | false;
  class?: string;
  children: JSX.Element;
};

export type AppOverviewPanelProps = {
  title: JSX.Element;
  description?: JSX.Element;
  toolbar?: JSX.Element;
  class?: string;
  children: JSX.Element;
};

export type AppOverviewEmptyStateProps = {
  title: JSX.Element;
  description?: JSX.Element;
  icon?: string;
  class?: string;
  children?: JSX.Element;
};

type AppOverviewComponent = ((props: AppOverviewProps) => JSX.Element) & {
  Main: (props: AppOverviewPanelProps) => JSX.Element;
  Aside: (props: AppOverviewPanelProps) => JSX.Element;
  EmptyState: (props: AppOverviewEmptyStateProps) => JSX.Element;
};

const AppOverviewMain = (props: AppOverviewPanelProps): JSX.Element => (
  <section class={`k2b-app-overview__main ${props.class ?? ""}`}>
    <PanelHeader title={props.title} subtitle={props.description} actions={props.toolbar} size="md" />
    <div class="k2b-app-overview__panel-content">{props.children}</div>
  </section>
);

const AppOverviewAside = (props: AppOverviewPanelProps): JSX.Element => (
  <aside class={`k2b-app-overview__aside ${props.class ?? ""}`}>
    <PanelHeader title={props.title} subtitle={props.description} actions={props.toolbar} size="md" />
    <div class="k2b-app-overview__panel-content">{props.children}</div>
  </aside>
);

const AppOverviewEmptyState = (props: AppOverviewEmptyStateProps): JSX.Element => (
  <Placeholder
    surface="paper"
    variant="panel"
    title={props.title}
    description={props.description}
    icon={props.icon}
    action={props.children}
    class={props.class}
  />
);

const AppOverview = ((props: AppOverviewProps): JSX.Element => (
  <div class={`k2b-app-overview ${props.class ?? ""}`}>
    <header class="k2b-app-overview__header">
      <Show when={props.icon !== false}>
        <span class="k2b-app-overview__icon" aria-hidden="true">
          <i class={props.icon || "ti ti-apps"} />
        </span>
      </Show>
      <div class="k2b-app-overview__identity">
        <h1>{props.title}</h1>
        <Show when={props.subtitle}>
          <p>{props.subtitle}</p>
        </Show>
      </div>
    </header>
    <div class="k2b-app-overview__columns">{props.children}</div>
  </div>
)) as AppOverviewComponent;

AppOverview.Main = AppOverviewMain;
AppOverview.Aside = AppOverviewAside;
AppOverview.EmptyState = AppOverviewEmptyState;

export default AppOverview;
