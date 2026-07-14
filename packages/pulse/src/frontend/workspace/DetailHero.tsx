import type { JSX } from "solid-js";

type Props = {
  eyebrow: string;
  title: string;
  description?: JSX.Element;
  icon: string;
  actions?: JSX.Element;
  quickActions?: JSX.Element;
};

export default function DetailHero(props: Props) {
  return (
    <header class="detail-header">
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs font-semibold text-secondary">{props.eyebrow}</span>
        {props.actions ? <div class="flex shrink-0 items-center gap-1">{props.actions}</div> : null}
      </div>

      <div class="mt-3 flex flex-col items-center text-center">
        <span class="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-zinc-100 app-accent-text dark:bg-zinc-900">
          <i class={`${props.icon} text-xl`} />
        </span>
        <div class="mt-2 min-w-0 max-w-full">
          <h2 class="truncate text-lg font-semibold leading-6 text-primary">{props.title}</h2>
          {props.description ? <div class="mt-0.5 truncate text-xs text-dimmed">{props.description}</div> : null}
        </div>
        {props.quickActions ? (
          <div class="mt-3 flex max-w-full flex-wrap items-center justify-center gap-2" role="group" aria-label={`${props.title} actions`}>
            {props.quickActions}
          </div>
        ) : null}
      </div>
    </header>
  );
}
