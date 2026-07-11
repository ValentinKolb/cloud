export type ProgressBarProps = {
  value: number;
  size?: "xs" | "sm" | "md";
  tone?: "primary" | "success" | "danger";
  showValue?: boolean;
  label?: string;
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
      return "progress-fill-success";
    case "danger":
      return "progress-fill-danger";
    default:
      return "progress-fill-primary";
  }
};

/**
 * Generic percentage progress bar for upload/job-like UI flows.
 */
export default function ProgressBar(props: ProgressBarProps) {
  const percent = () => clamp(props.value);

  return (
    <div class={`flex items-center gap-2 ${props.class ?? ""}`}>
      <div
        class={`progress-track min-w-0 flex-1 overflow-hidden rounded-full ${heightClass(props.size)}`}
        role="progressbar"
        aria-label={props.label ?? "Progress"}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={percent()}
      >
        <div class={`h-full transition-all duration-200 ${toneClass(props.tone)}`} style={`width: ${percent()}%`} />
      </div>
      {props.showValue ? <span class="shrink-0 tabular-nums text-[11px] text-dimmed">{percent()}%</span> : null}
    </div>
  );
}
