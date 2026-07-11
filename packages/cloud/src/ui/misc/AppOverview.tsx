import { type JSX, Show } from "solid-js";
import Placeholder from "./Placeholder";

export type AppOverviewProps = {
  title: string;
  subtitle?: string;
  icon: string;
  class?: string;
  children: JSX.Element;
};

export type AppOverviewPanelProps = {
  title: string;
  description?: JSX.Element;
  toolbar?: JSX.Element;
  class?: string;
  children: JSX.Element;
};

export type AppOverviewEmptyStateProps = {
  title: string;
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

const tablerIconClass = (icon: string | null | undefined, fallback: string): string => {
  const value = icon?.trim() || fallback;
  return value.startsWith("ti ") ? value : `ti ${value}`;
};

const PanelHeader = (props: Pick<AppOverviewPanelProps, "title" | "description" | "toolbar">) => (
  <div class="app-overview-panel-header mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
    <div class="min-w-0">
      <h2 class="text-sm font-semibold text-primary">{props.title}</h2>
      <Show when={props.description}>
        <p class="text-xs text-dimmed">{props.description}</p>
      </Show>
    </div>
    <Show when={props.toolbar}>
      <div class="app-overview-toolbar w-full sm:w-80">{props.toolbar}</div>
    </Show>
  </div>
);

const AppOverviewMain = (props: AppOverviewPanelProps) => (
  <section class={`min-w-0 flex-1 w-full ${props.class ?? ""}`}>
    <PanelHeader title={props.title} description={props.description} toolbar={props.toolbar} />
    {props.children}
  </section>
);

const AppOverviewAside = (props: AppOverviewPanelProps) => (
  <aside class={`min-w-0 w-full shrink-0 lg:w-96 ${props.class ?? ""}`}>
    <PanelHeader title={props.title} description={props.description} toolbar={props.toolbar} />
    {props.children}
  </aside>
);

const AppOverviewEmptyState = (props: AppOverviewEmptyStateProps) => (
  <Placeholder
    surface="paper"
    variant="panel"
    title={props.title}
    description={props.description}
    icon={props.icon ? tablerIconClass(props.icon, "ti-inbox") : undefined}
    action={props.children}
    class={props.class}
  />
);

const AppOverview = ((props: AppOverviewProps) => (
  <div class={`app-overview mx-auto max-w-6xl p-3 sm:p-4 ${props.class ?? ""}`}>
    <header class="app-overview-header mb-5">
      <div class="app-overview-identity flex items-center gap-3">
        <div class="app-overview-icon thumbnail flex h-11 w-11 shrink-0 items-center justify-center bg-zinc-100 dark:bg-zinc-800">
          <i class={`${tablerIconClass(props.icon, "ti-apps")} text-xl text-zinc-600 dark:text-zinc-400`} />
        </div>
        <div class="min-w-0">
          <h1 class="app-overview-title text-xl font-semibold text-primary">{props.title}</h1>
          <Show when={props.subtitle}>
            <p class="app-overview-subtitle text-sm text-dimmed">{props.subtitle}</p>
          </Show>
        </div>
      </div>
    </header>

    <div class="app-overview-columns flex flex-col items-start gap-4 lg:flex-row">{props.children}</div>
  </div>
)) as AppOverviewComponent;

AppOverview.Main = AppOverviewMain;
AppOverview.Aside = AppOverviewAside;
AppOverview.EmptyState = AppOverviewEmptyState;

export default AppOverview;
