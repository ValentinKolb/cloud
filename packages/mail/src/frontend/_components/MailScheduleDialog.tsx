import { DateTimePicker, prompts } from "@valentinkolb/cloud/ui";
import { type DateContext, dates } from "@valentinkolb/stdlib";
import { createMemo, createSignal, Show } from "solid-js";

const nextQuarterHour = (): string => {
  const date = new Date(Date.now() + 60 * 60_000);
  date.setUTCSeconds(0, 0);
  date.setUTCMinutes(Math.ceil(date.getUTCMinutes() / 15) * 15);
  return date.toISOString();
};

export const chooseScheduledSendTime = (dateConfig: DateContext): Promise<string | null | undefined> =>
  prompts.dialog<string | null>(
    (close) => {
      const [value, setValue] = createSignal<string | null>(nextQuarterHour());
      const error = createMemo(() => {
        const instant = value() ? Date.parse(value()!) : Number.NaN;
        if (!Number.isFinite(instant)) return "Choose a delivery date and time.";
        if (instant < Date.now() + 60_000) return "Choose a time at least one minute in the future.";
        return null;
      });
      const schedule = () => {
        if (!value() || error()) return;
        close(value());
      };

      return (
        <div class="flex flex-col gap-4">
          <p class="text-sm text-secondary">The message remains visible under Scheduled and can be cancelled until delivery starts.</p>
          <DateTimePicker
            label="Delivery time"
            placeholder="Choose date and time"
            value={value}
            onChange={setValue}
            dateConfig={dateConfig}
          />
          <Show when={error()} fallback={<p class="text-xs text-dimmed">Time zone: {dateConfig.timeZone}</p>}>
            {(message) => (
              <p class="text-xs text-red-600" role="alert">
                {message()}
              </p>
            )}
          </Show>
          <Show when={value() && !error()}>
            <div class="rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] px-3 py-2 text-sm text-secondary">
              <i class="ti ti-clock mr-2" aria-hidden="true" />
              Delivery is scheduled for <strong class="text-primary">{dates.formatDateTime(value()!, dateConfig)}</strong>.
            </div>
          </Show>
          <div class="flex items-center justify-end gap-2">
            <button type="button" class="btn-secondary btn-sm" onClick={() => close(null)}>
              Cancel
            </button>
            <button type="button" class="btn-primary btn-sm" disabled={Boolean(error())} onClick={schedule}>
              <i class="ti ti-calendar-time" aria-hidden="true" />
              Schedule
            </button>
          </div>
        </div>
      );
    },
    { title: "Schedule delivery", icon: "ti ti-calendar-time", size: "medium" },
  );
