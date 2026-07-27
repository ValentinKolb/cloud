import { type JSX, Show } from "solid-js";
import Chart from "../content/Chart";
import { type StatGridSize, useStatGrid } from "./StatGrid";
import type { StatusTone } from "./StatusBadge";

export type StatCellAccent = {
  tone?: StatusTone;
  icon?: string;
  text?: string;
  href?: string;
};

export type StatCellProps = {
  label: JSX.Element;
  value: JSX.Element;
  sub?: JSX.Element;
  tone?: StatusTone;
  accent?: StatCellAccent;
  href?: string;
  title?: string;
  trend?: number[];
  size?: StatGridSize;
  class?: string;
};

const StatCellBody = (props: StatCellProps & { linked: boolean }): JSX.Element => {
  const grid = useStatGrid();
  const size = () => props.size ?? grid.size;
  const accent = (
    <Show when={props.accent}>
      {(value) => {
        const content = (
          <>
            <Show when={value().icon}>{(icon) => <i class={icon()} aria-hidden="true" />}</Show>
            <Show when={value().text}>{(text) => <span>{text()}</span>}</Show>
          </>
        );
        return (
          <Show
            when={!props.linked && value().text ? value().href || undefined : undefined}
            fallback={
              <span class="k2b-stat-cell__accent" data-k2b-tone data-tone={value().tone ?? "neutral"}>
                {content}
              </span>
            }
          >
            {(href) => (
              <a href={href()} class="k2b-stat-cell__accent" data-k2b-tone data-tone={value().tone ?? "neutral"}>
                {content}
              </a>
            )}
          </Show>
        );
      }}
    </Show>
  );

  return (
    <>
      <span class="k2b-stat-cell__label">{props.label}</span>
      <span class="k2b-stat-cell__value" data-size={size()} data-k2b-tone data-tone={props.tone ?? "neutral"} title={props.title}>
        {props.value}
      </span>
      <Show when={props.trend && props.trend.length > 1}>
        <Chart kind="sparkline" class="k2b-stat-cell__trend" style={{ height: "2rem" }} data={props.trend ?? []} showLast showMinMax />
      </Show>
      <Show when={props.sub || props.accent}>
        <span class="k2b-stat-cell__support">
          <Show when={props.sub}>
            <span class="k2b-stat-cell__sub">{props.sub}</span>
          </Show>
          {accent}
        </span>
      </Show>
    </>
  );
};

export function StatCell(props: StatCellProps): JSX.Element {
  const grid = useStatGrid();
  const className = () => `k2b-stat-cell ${props.class ?? ""}`;

  return (
    <Show
      when={props.href}
      fallback={
        <div class={className()} data-surface={grid.surface}>
          <StatCellBody {...props} linked={false} />
        </div>
      }
    >
      {(href) => (
        <a href={href()} class={className()} data-surface={grid.surface}>
          <StatCellBody {...props} linked />
          <i class="ti ti-arrow-up-right k2b-stat-cell__link-icon" aria-hidden="true" />
        </a>
      )}
    </Show>
  );
}
