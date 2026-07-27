import { createContext, type JSX, Show, useContext } from "solid-js";

export type StatGridSize = "sm" | "md";
export type StatGridSurface = "default" | "muted";

export type StatGridAction = {
  label: string;
  href: string;
};

export type StatGridProps = {
  children: JSX.Element;
  title?: JSX.Element;
  action?: StatGridAction;
  columns?: number;
  size?: StatGridSize;
  surface?: StatGridSurface;
  class?: string;
};

type StatGridContextValue = {
  size: StatGridSize;
  surface: StatGridSurface;
};

const StatGridContext = createContext<StatGridContextValue>({
  size: "md",
  surface: "default",
});

export const useStatGrid = (): StatGridContextValue => useContext(StatGridContext);

export function StatGrid(props: StatGridProps): JSX.Element {
  const columns = () => Math.min(Math.max(Math.round(props.columns ?? 4), 1), 6);
  const context = (): StatGridContextValue => ({
    size: props.size ?? "md",
    surface: props.surface ?? "default",
  });

  return (
    <section
      class={`k2b-stat-grid ${props.class ?? ""}`}
      data-surface={context().surface}
      data-columns={columns()}
      style={{ "--k2b-stat-columns": String(columns()) }}
    >
      <Show when={props.title}>
        <header class="k2b-stat-grid__header">
          <h2>{props.title}</h2>
          <Show when={props.action}>
            {(action) => (
              <a href={action().href}>
                {action().label}
                <i class="ti ti-arrow-up-right" aria-hidden="true" />
              </a>
            )}
          </Show>
        </header>
      </Show>
      <StatGridContext.Provider value={context()}>
        <div class="k2b-stat-grid__body">{props.children}</div>
      </StatGridContext.Provider>
    </section>
  );
}
