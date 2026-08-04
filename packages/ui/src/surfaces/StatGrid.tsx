import { createContext, type JSX, Show, useContext } from "solid-js";

export type StatGridSize = "md" | "sm";
export type StatGridSurface = "white" | "muted";
export type StatGridColumns = 1 | 2 | 3 | 4 | 5 | 6;
export type StatGridAction = { label: string; href: string };

export type StatGridProps = {
  children: JSX.Element;
  title?: string;
  action?: StatGridAction;
  columns?: StatGridColumns;
  size?: StatGridSize;
  surface?: StatGridSurface;
  class?: string;
};

const StatGridSizeContext = createContext<StatGridSize>("md");
const StatGridSurfaceContext = createContext<StatGridSurface>("white");

export const useStatGridSize = (): StatGridSize => useContext(StatGridSizeContext);
export const useStatGridSurface = (): StatGridSurface => useContext(StatGridSurfaceContext);

const columnValue = (columns?: StatGridColumns): StatGridColumns => {
  if (columns && Number.isInteger(columns) && columns >= 1 && columns <= 6) return columns;
  return 6;
};

export function StatGrid(props: StatGridProps): JSX.Element {
  const surface = () => props.surface ?? "white";
  return (
    <div class={`k2b-stat-grid ${props.class ?? ""}`} data-columns={columnValue(props.columns)} data-surface={surface()}>
      <Show when={props.title}>
        <header class="k2b-stat-grid__header">
          <span class="k2b-stat-grid__title">{props.title}</span>
          <Show when={props.action}>
            {(action) => (
              <a href={action().href} class="k2b-stat-grid__action">
                <span>{action().label}</span>
                <i class="ti ti-arrow-up-right" aria-hidden="true" />
              </a>
            )}
          </Show>
        </header>
      </Show>
      <StatGridSizeContext.Provider value={props.size ?? "md"}>
        <StatGridSurfaceContext.Provider value={surface()}>
          <div class="k2b-stat-grid__body">{props.children}</div>
        </StatGridSurfaceContext.Provider>
      </StatGridSizeContext.Provider>
    </div>
  );
}

export default StatGrid;
