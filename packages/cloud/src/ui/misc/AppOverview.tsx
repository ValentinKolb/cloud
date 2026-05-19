import { Show, type JSX } from "solid-js";

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
  <div class="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
    <div class="min-w-0">
      <h2 class="text-sm font-semibold text-primary">{props.title}</h2>
      <Show when={props.description}>
        <p class="text-xs text-dimmed">{props.description}</p>
      </Show>
    </div>
    <Show when={props.toolbar}>
      <div class="w-full sm:w-80">{props.toolbar}</div>
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
  <div class={`paper flex min-h-56 flex-col items-center justify-center p-8 text-center ${props.class ?? ""}`}>
    <Show when={props.icon}>
      <div class="thumbnail mb-3 flex h-12 w-12 items-center justify-center bg-zinc-100 dark:bg-zinc-800">
        <i class={`${tablerIconClass(props.icon, "ti-inbox")} text-xl text-dimmed`} />
      </div>
    </Show>
    <h3 class="mb-1 text-sm font-semibold text-primary">{props.title}</h3>
    <Show when={props.description}>
      <p class="max-w-sm text-xs text-dimmed">{props.description}</p>
    </Show>
    {props.children}
  </div>
);

const AppOverview = ((props: AppOverviewProps) => (
  <div class={`mx-auto max-w-6xl p-3 sm:p-4 ${props.class ?? ""}`}>
    <header class="mb-5">
      <div class="flex items-center gap-3">
        <div class="thumbnail flex h-11 w-11 shrink-0 items-center justify-center bg-zinc-100 dark:bg-zinc-800">
          <i class={`${tablerIconClass(props.icon, "ti-apps")} text-xl text-zinc-600 dark:text-zinc-400`} />
        </div>
        <div class="min-w-0">
          <h1 class="text-xl font-semibold text-primary">{props.title}</h1>
          <Show when={props.subtitle}>
            <p class="text-sm text-dimmed">{props.subtitle}</p>
          </Show>
        </div>
      </div>
    </header>

    <div class="flex flex-col items-start gap-4 lg:flex-row">{props.children}</div>
  </div>
)) as AppOverviewComponent;

AppOverview.Main = AppOverviewMain;
AppOverview.Aside = AppOverviewAside;
AppOverview.EmptyState = AppOverviewEmptyState;

export default AppOverview;
