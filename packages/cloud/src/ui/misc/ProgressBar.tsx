type ProgressBarProps = {
  value: number;
  size?: "xs" | "sm" | "md";
  tone?: "primary" | "success" | "danger";
  showValue?: boolean;
  class?: string;
};

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const heightClass = (size: ProgressBarProps["size"]) => {
  switch (size) {
    case "xs":
      return "h-1.5";
    case "sm":
      return "h-2";
    default:
      return "h-2.5";
  }
};

const toneClass = (tone: ProgressBarProps["tone"]) => {
  switch (tone) {
    case "success":
      return "bg-green-500";
    case "danger":
      return "bg-red-500";
    default:
      return "bg-blue-500";
  }
};

/**
 * Generic percentage progress bar for upload/job-like UI flows.
 */
export default function ProgressBar(props: ProgressBarProps) {
  const percent = () => clamp(props.value);

  return (
    <div class={`flex items-center gap-2 ${props.class ?? ""}`}>
      <div class={`flex-1 min-w-0 rounded-full overflow-hidden bg-zinc-200 dark:bg-zinc-700 [box-shadow:var(--theme-recess)] ${heightClass(props.size)}`}>
        <div class={`h-full transition-all duration-200 ${toneClass(props.tone)}`} style={`width: ${percent()}%`} />
      </div>
      {props.showValue ? <span class="shrink-0 tabular-nums text-[11px] text-dimmed">{percent()}%</span> : null}
    </div>
  );
}
