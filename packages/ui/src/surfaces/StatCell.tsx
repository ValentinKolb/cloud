import { type JSX, Show } from "solid-js";
import Chart from "../content/Chart";
import { type StatGridSize, useStatGridSize, useStatGridSurface } from "./StatGrid";

export type StatCellTone = "emerald" | "amber" | "red" | "blue" | "zinc";

export type StatCellAccent = {
  tone: StatCellTone;
  icon: string;
  text?: string;
  href?: string;
};

export type StatCellProps = {
  label: string;
  value: string | number | JSX.Element;
  sub?: string;
  valueClass?: string;
  accent?: StatCellAccent;
  href?: string;
  title?: string;
  trend?: number[];
  size?: StatGridSize;
};

function Body(props: StatCellProps & { cellIsLink: boolean }): JSX.Element {
  const gridSize = useStatGridSize();
  const size = () => props.size ?? gridSize;
  const accent = () => props.accent;
  return (
    <>
      <span class="k2b-stat-cell__label" data-size={size()}>{props.label}</span>
      <span class={`k2b-stat-cell__value ${props.valueClass ?? ""}`} data-size={size()} title={props.title}>{props.value}</span>
      <Show when={props.trend && props.trend.length > 1}>
        <Chart kind="sparkline" class="k2b-stat-cell__trend" style={{ height: "32px" }} data={props.trend ?? []} showLast showMinMax />
      </Show>
      <Show when={props.sub || accent()}>
        <div class="k2b-stat-cell__support">
          <Show when={props.sub}>{(sub) => <span class="k2b-stat-cell__sub">{sub()}</span>}</Show>
          <Show when={accent()}>
            {(value) => (
              <Show
                when={value().text}
                fallback={<i class={`${value().icon} k2b-stat-cell__accent-icon`} data-tone={value().tone} aria-hidden="true" />}
              >
                {(text) => (
                  <Show
                    when={value().href && !props.cellIsLink ? value().href : undefined}
                    fallback={
                      <span class="k2b-stat-cell__accent" data-tone={value().tone}>
                        <i class={value().icon} aria-hidden="true" />{text()}
                      </span>
                    }
                  >
                    {(href) => (
                      <a href={href()} class="k2b-stat-cell__accent" data-tone={value().tone}>
                        <i class={value().icon} aria-hidden="true" />{text()}
                      </a>
                    )}
                  </Show>
                )}
              </Show>
            )}
          </Show>
        </div>
      </Show>
    </>
  );
}

export function StatCell(props: StatCellProps): JSX.Element {
  const gridSize = useStatGridSize();
  const size = () => props.size ?? gridSize;
  const surface = useStatGridSurface();
  return (
    <Show
      when={props.href}
      fallback={<div class="k2b-stat-cell" data-size={size()} data-surface={surface}><Body {...props} cellIsLink={false} /></div>}
    >
      {(href) => (
        <a href={href()} class="k2b-stat-cell k2b-stat-cell--link" data-size={size()} data-surface={surface}>
          <i class="ti ti-external-link k2b-stat-cell__link-icon" aria-hidden="true" />
          <Body {...props} cellIsLink />
        </a>
      )}
    </Show>
  );
}

export default StatCell;
