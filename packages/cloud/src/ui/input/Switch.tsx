import type { SwitchInputProps } from "./types";

/**
 * Toggle switch component - accessible via hidden checkbox
 */
const Switch = ({ label, value, onChange, disabled = false }: SwitchInputProps) => {
  const inputId = crypto.randomUUID();

  return (
    <label
      for={inputId}
      class={`inline-flex items-center gap-2 select-none ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
    >
      {/* Hidden checkbox for accessibility */}
      <input
        id={inputId}
        type="checkbox"
        checked={value?.() || false}
        onChange={(e) => onChange?.(e.target.checked)}
        disabled={disabled}
        class="sr-only peer"
      />
      {/* Visual switch track */}
      <span
        data-state={value?.() ? "checked" : "idle"}
        class={`
 ui-switch-track relative transition-colors
 w-9 h-5 rounded-full
 [box-shadow:var(--theme-recess)]

 bg-zinc-200 dark:bg-zinc-600/40
 peer-checked:bg-blue-500
 
 peer-focus-visible:[box-shadow:var(--theme-focus-ring)]
 
 peer-disabled:opacity-50
 `}
      >
        {/* Switch knob */}
        <span
          class={`
 absolute transition-transform flex items-center justify-center
 top-0.5 left-0.5 w-4 h-4 rounded-full
 
 bg-white shadow-sm
 
 `}
          classList={{
            "translate-x-4": value?.(),
            "": value?.(),
          }}
        >
          {/* Checkmark icon in terminal mode when checked */}
          <i class={`ti ti-check hidden text-[8px] leading-none ${value?.() ? " " : "text-transparent"}`} />
        </span>
      </span>
      {label && <span class="text-xs text-secondary select-none">{label}</span>}
    </label>
  );
};

export { Switch };
export const SwitchInput = Switch;
export default Switch;
