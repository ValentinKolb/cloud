import type { JSX } from "solid-js";

type AccountFact = {
  label: string;
  value: JSX.Element;
};

type Props = {
  facts: AccountFact[];
  columns?: 3 | 4;
  viewTransitionName?: string;
};

export default function AccountsFactGrid(props: Props) {
  const columnClass = () => (props.columns === 4 ? "xl:grid-cols-4" : "xl:grid-cols-3");

  return (
    <div class="paper p-4" style={props.viewTransitionName ? { "view-transition-name": props.viewTransitionName } : undefined}>
      <dl class={`grid gap-3 sm:grid-cols-2 ${columnClass()}`}>
        {props.facts.map((fact) => (
          <div class="min-w-0 rounded-lg bg-zinc-50/85 px-3 py-2.5 ring-1 ring-inset ring-zinc-200/60 dark:bg-zinc-900/70 dark:ring-zinc-800/80">
            <dt class="text-[10px] font-medium uppercase tracking-[0.18em] text-dimmed">{fact.label}</dt>
            <dd class="mt-1 min-w-0 truncate text-xs font-medium text-primary">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
