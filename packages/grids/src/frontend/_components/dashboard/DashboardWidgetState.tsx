type Props = {
  kind: "loading" | "empty" | "error";
  title?: string;
  detail?: string | null;
};

const defaults = {
  loading: { icon: "ti-loader-2 animate-spin", title: "Loading widget", tone: "text-dimmed" },
  empty: { icon: "ti-database-off", title: "No matching data", tone: "text-dimmed" },
  error: { icon: "ti-alert-circle", title: "Widget could not load", tone: "text-red-600 dark:text-red-400" },
} as const;

export default function DashboardWidgetState(props: Props) {
  const state = () => defaults[props.kind];
  return (
    <div
      class={`flex min-h-20 flex-1 flex-col items-center justify-center gap-1 px-4 py-6 text-center ${state().tone}`}
      role={props.kind === "error" ? "alert" : "status"}
    >
      <i class={`ti ${state().icon} text-lg`} />
      <p class="text-xs font-medium">{props.title ?? state().title}</p>
      {props.detail ? <p class="max-w-full break-words text-[11px] text-dimmed">{props.detail}</p> : null}
    </div>
  );
}
