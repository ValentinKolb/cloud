import type { JSX } from "solid-js";

type Props = {
  eyebrow: string;
  title: string;
  description?: JSX.Element;
  icon: string;
  actions?: JSX.Element;
};

export default function DetailHero(props: Props) {
  return (
    <header class="flex shrink-0 flex-wrap items-start gap-3 px-3 py-2">
      <span class="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 app-accent-text dark:bg-zinc-900">
        <i class={`${props.icon} text-base`} />
      </span>
      <div class="min-w-0 flex-1">
        <p class="text-label text-[11px]">{props.eyebrow}</p>
        <h2 class="mt-0.5 truncate text-lg font-semibold leading-6 text-primary">{props.title}</h2>
        {props.description ? <div class="mt-0.5 truncate text-xs text-dimmed">{props.description}</div> : null}
      </div>
      {props.actions ? <div class="flex shrink-0 items-center gap-1">{props.actions}</div> : null}
    </header>
  );
}
