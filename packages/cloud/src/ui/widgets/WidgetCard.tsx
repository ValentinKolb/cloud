import type { JSX } from "solid-js/jsx-runtime";

type WidgetCardProps = {
  title: string;
  icon: string;
  children: JSX.Element;
};

export default function WidgetCard({ title, icon, children }: WidgetCardProps) {
  return (
    <div class="border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-4 h-72 sm:h-80 flex flex-col rounded-2xl">
      <div class="flex items-center gap-2 mb-3 shrink-0">
        <i class={`ti ti-${icon} text-dimmed`} />
        <span class="text-sm font-medium text-primary">{title}</span>
      </div>
      {children}
    </div>
  );
}
