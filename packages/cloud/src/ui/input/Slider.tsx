type SliderProps = {
  label?: string;
  description?: string;
  value: () => number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  showValue?: boolean;
  formatValue?: (value: number) => string;
  /** When true, the track fill originates from the center instead of the left edge. */
  center?: boolean;
  /** Value to reset to on double-click. Defaults to center of range (if center) or min. */
  defaultValue?: number;
};

/**
 * Range slider input component.
 */
const Slider = ({
  label,
  description,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  showValue = true,
  formatValue = (v) => String(v),
  center = false,
  defaultValue,
}: SliderProps) => {
  const resetValue = defaultValue ?? (center ? (min + max) / 2 : min);
  const inputId = crypto.randomUUID();
  const descId = description ? `${inputId}-desc` : undefined;

  const percentage = () => ((value() - min) / (max - min)) * 100;

  const trackBackground = () => {
    const p = percentage();
    const fill = "var(--slider-fill)";
    const track = "var(--slider-track)";

    if (center) {
      const lo = Math.min(50, p);
      const hi = Math.max(50, p);
      return `linear-gradient(to right, ${track} 0%, ${track} ${lo}%, ${fill} ${lo}%, ${fill} ${hi}%, ${track} ${hi}%, ${track} 100%)`;
    }
    return `linear-gradient(to right, ${fill} 0%, ${fill} ${p}%, ${track} ${p}%, ${track} 100%)`;
  };

  return (
    <div class="flex flex-col gap-1 slider-track-colors" classList={{ "opacity-50": disabled }}>
      {(label || showValue) && (
        <div class="flex items-center justify-between text-xs">
          {label && (
            <label for={inputId} class="text-secondary">
              {label}
            </label>
          )}
          {showValue && <span class="text-dimmed tabular-nums">{formatValue(value())}</span>}
        </div>
      )}
      {description && (
        <p id={descId} class="text-xs text-dimmed -mt-0.5">
          {description}
        </p>
      )}
      <input
        id={inputId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value()}
        onInput={(e) => onChange(Number(e.currentTarget.value))}
        onDblClick={() => onChange(resetValue)}
        disabled={disabled}
        aria-describedby={descId}
        class="w-full h-1.5 appearance-none cursor-pointer
 rounded-full 
 [&::-webkit-slider-thumb]:appearance-none
 [&::-webkit-slider-thumb]:w-3.5
 [&::-webkit-slider-thumb]:h-3.5
 [&::-webkit-slider-thumb]:cursor-pointer
 [&::-webkit-slider-thumb]:transition-transform
 [&::-webkit-slider-thumb]:rounded-full
 [&::-webkit-slider-thumb]:bg-blue-500
 [&::-webkit-slider-thumb]:dark:bg-blue-400
 [&::-webkit-slider-thumb]:shadow-sm
 [&::-webkit-slider-thumb]:hover:scale-110
 ]:rounded-none
 ]:bg-(--slider-fill)
 [&::-moz-range-thumb]:w-3.5
 [&::-moz-range-thumb]:h-3.5
 [&::-moz-range-thumb]:border-0
 [&::-moz-range-thumb]:cursor-pointer
 [&::-moz-range-thumb]:rounded-full
 [&::-moz-range-thumb]:bg-blue-500
 [&::-moz-range-thumb]:dark:bg-blue-400
 ]:rounded-none
 ]:bg-(--slider-fill)
 focus-visible:outline-none
 focus-visible:[&::-webkit-slider-thumb]:ring-2
 focus-visible:[&::-webkit-slider-thumb]:ring-zinc-400
 focus-visible:[&::-webkit-slider-thumb]:ring-offset-2
 disabled:cursor-not-allowed
 disabled:[&::-webkit-slider-thumb]:bg-zinc-400
 disabled:[&::-moz-range-thumb]:bg-zinc-400"
        style={{ background: trackBackground() }}
      />
    </div>
  );
};

export default Slider;
