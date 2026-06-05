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

// Per-colour hover: the card tints toward its own accent (border + soft bg).
const hoverClasses = {
  blue: "hover:border-blue-300 hover:bg-blue-50/50 dark:hover:border-blue-800 dark:hover:bg-blue-950/25",
  emerald: "hover:border-emerald-300 hover:bg-emerald-50/50 dark:hover:border-emerald-800 dark:hover:bg-emerald-950/25",
  violet: "hover:border-violet-300 hover:bg-violet-50/50 dark:hover:border-violet-800 dark:hover:bg-violet-950/25",
  orange: "hover:border-orange-300 hover:bg-orange-50/50 dark:hover:border-orange-800 dark:hover:bg-orange-950/25",
  red: "hover:border-red-300 hover:bg-red-50/50 dark:hover:border-red-800 dark:hover:bg-red-950/25",
  amber: "hover:border-amber-300 hover:bg-amber-50/50 dark:hover:border-amber-800 dark:hover:bg-amber-950/25",
  zinc: "hover:border-zinc-300 hover:bg-zinc-50 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/40",
  cyan: "hover:border-cyan-300 hover:bg-cyan-50/50 dark:hover:border-cyan-800 dark:hover:bg-cyan-950/25",
  rose: "hover:border-rose-300 hover:bg-rose-50/50 dark:hover:border-rose-800 dark:hover:bg-rose-950/25",
};

export default function LinkCard(props: LinkCardProps) {
  return (
    <a href={props.href} class={`paper group p-4 flex items-center gap-4 transition-all ${hoverClasses[props.color]}`}>
      <div class={`flex items-center justify-center h-10 w-10 shrink-0 rounded ${colorClasses[props.color]}`}>
        <i class={`${props.icon} text-xl`} />
      </div>
      <div class="flex-1 min-w-0">
        <span class="text-sm font-semibold text-primary block">{props.title}</span>
        <p class="text-xs text-dimmed truncate">{props.description}</p>
      </div>
      <i class="ti ti-chevron-right text-dimmed transition-transform group-hover:translate-x-0.5 group-hover:text-secondary" />
    </a>
  );
}
