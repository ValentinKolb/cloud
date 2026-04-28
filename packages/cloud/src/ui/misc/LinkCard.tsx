type LinkCardProps = {
  href: string;
  title: string;
  description: string;
  icon: string;
  color: "blue" | "emerald" | "violet" | "orange" | "red" | "amber" | "zinc" | "cyan" | "rose";
};

const colorClasses = {
  blue: "bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400",
  emerald: "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400",
  violet: "bg-violet-100 dark:bg-violet-900/50 text-violet-600 dark:text-violet-400",
  orange: "bg-orange-100 dark:bg-orange-900/50 text-orange-600 dark:text-orange-400",
  red: "bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400",
  amber: "bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400",
  zinc: "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400",
  cyan: "bg-cyan-100 dark:bg-cyan-900/50 text-cyan-600 dark:text-cyan-400",
  rose: "bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-400",
};

export default function LinkCard(props: LinkCardProps) {
  return (
    <a href={props.href} class="paper p-4 flex items-center gap-4 hover:paper-highlighted transition-all">
      <div class={`flex items-center justify-center h-10 w-10 shrink-0 rounded ${colorClasses[props.color]}`}>
        <i class={`${props.icon} text-xl`} />
      </div>
      <div class="flex-1 min-w-0">
        <span class="text-sm font-semibold text-primary block">{props.title}</span>
        <p class="text-xs text-dimmed truncate">{props.description}</p>
      </div>
      <i class="ti ti-chevron-right text-dimmed" />
    </a>
  );
}
