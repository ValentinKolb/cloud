import { dates, type DateContext } from "@valentinkolb/stdlib";
import { InputWrapper, createInputA11y } from "./util";

type DateTimeInputProps = {
  label?: string;
  description?: string;
  placeholder?: string;
  value?: () => string | undefined | null;
  onChange?: (value: string) => void;
  error?: () => string | undefined;
  required?: boolean;
  disabled?: boolean;
  /** Use date-only input instead of datetime-local */
  dateOnly?: boolean;
  /** Optional stdlib date context. When set, datetime values are edited in this timezone. */
  dateConfig?: DateContext;
  /** Convenience override for dateConfig.timeZone. */
  timeZone?: string;
};

/**
 * Date/DateTime input component using native browser inputs
 * @param label - Optional label text
 * @param description - Optional description text
 * @param placeholder - Placeholder text (not shown in date inputs)
 * @param value - Reactive value getter (ISO string or datetime-local format)
 * @param onChange - Called on change event with datetime-local format string
 * @param error - Reactive error message getter
 * @param required - Show required asterisk after label
 * @param disabled - Disable the input
 * @param dateOnly - Use date input instead of datetime-local
 */
const DateTimeInput = (props: DateTimeInputProps) => {
  const disabled = () => props.disabled ?? false;
  const dateOnly = () => props.dateOnly ?? false;
  const icon = () => (dateOnly() ? "ti ti-calendar" : "ti ti-calendar-time");
  const a11y = createInputA11y({ description: props.description, error: props.error });
  const dateContext = (): DateContext => ({
    ...props.dateConfig,
    timeZone: props.timeZone ?? props.dateConfig?.timeZone,
  });
  const timezone = () => dateContext().timeZone;

  // Convert ISO string to input format if needed
  const inputValue = () => {
    const v = props.value?.();
    if (!v) return "";
    // If it's already in the right format, return as-is
    if (!v.includes("Z") && !v.includes("+")) return v;
    if (timezone()) {
      if (dateOnly()) return dates.formatDateKey(v, dateContext());
      return dates.instantToZonedInput(v, timezone()!);
    }
    // Convert ISO to local datetime-local format
    const d = new Date(v);
    if (dateOnly()) {
      return d.toISOString().slice(0, 10);
    }
    // Get local time
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  const outputValue = (value: string) => {
    if (!value || dateOnly() || !timezone()) return value;
    return dates.zonedDateTimeToInstant(value, timezone()!, { disambiguation: "compatible" });
  };

  return (
    <InputWrapper
      label={props.label}
      description={props.description}
      error={props.error?.()}
      required={props.required}
      inputId={a11y.inputId}
      descriptionId={a11y.descriptionId}
      errorId={a11y.errorId}
    >
      <div class="group relative">
        <div class="absolute inset-y-0 left-3 z-10 flex items-center pointer-events-none text-zinc-400 dark:text-zinc-500">
          <i class={`${icon()} group-focus-within:text-blue-500`} />
        </div>
        <input
          id={a11y.inputId}
          type={dateOnly() ? "date" : "datetime-local"}
          class={`input w-full pl-9 ${disabled() ? "cursor-not-allowed opacity-50" : ""}`}
          value={inputValue()}
          onChange={(e) => props.onChange?.(outputValue(e.currentTarget.value))}
          disabled={disabled()}
          aria-label={!props.label ? props.placeholder : undefined}
          aria-describedby={a11y.ariaDescribedBy()}
          aria-invalid={!!props.error?.()}
          aria-required={props.required}
          aria-disabled={disabled()}
        />
      </div>
    </InputWrapper>
  );
};

export default DateTimeInput;
