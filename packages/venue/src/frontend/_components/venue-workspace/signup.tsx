import {
  CheckboxCardInput,
  DateRangePicker,
  type DateRangeValue,
  PanelDialog,
  Placeholder,
  prompts,
  SegmentedControl,
  TextInput,
  toast,
} from "@valentinkolb/cloud/ui";
import { refreshCurrentPath } from "@valentinkolb/ssr/nav";
import { cookies } from "@valentinkolb/stdlib/browser";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { apiClient } from "../../../api/client";
import type { UpcomingSlot, VenueDashboard } from "../../../contracts";
import { DOUBLE_CLICK_CONFIRM_COOKIE } from "./constants";
import { ProgressBar } from "./schedule";
import { defaultShiftRange, fmt, fmtTime, isSlotActive, readError, timeZoneDateConfig } from "./utils";

export function SignupDialog(props: { dashboard: VenueDashboard; close: (changed: boolean) => void }) {
  const defaultMode = props.dashboard.venue.signupMode === "free" ? "free" : "shifts";
  const [mode, setMode] = createSignal<"shifts" | "free">(defaultMode);
  const [freeRange, setFreeRange] = createSignal<DateRangeValue>(defaultShiftRange());
  const [note, setNote] = createSignal("");
  const availableSlots = createMemo(() => props.dashboard.slots.filter(isSlotActive).slice(0, 16));

  const signup = mutation.create<void, { slot: UpcomingSlot; weeks?: number }>({
    mutation: async ({ slot, weeks }) => {
      const target = apiClient.venues[":id"].templates[":templateId"];
      const res = weeks
        ? await target["signup-weeks"].$post({
            param: { id: props.dashboard.venue.id, templateId: slot.template.id },
            json: { date: slot.date, weeks },
          })
        : await target.signup.$post({
            param: { id: props.dashboard.venue.id, templateId: slot.template.id },
            json: { date: slot.date },
          });
      if (!res.ok) throw new Error(await readError(res, "Failed to sign up."));
    },
    onSuccess: () => {
      toast.success("Shift added");
      props.close(true);
      refreshCurrentPath();
    },
    onError: (err) => prompts.error(err.message),
  });

  const freeSignup = mutation.create<void, void>({
    mutation: async () => {
      const range = freeRange();
      if (!range.start || !range.end) throw new Error("Pick a start and end time.");
      const res = await apiClient.venues[":id"]["free-signup"].$post({
        param: { id: props.dashboard.venue.id },
        json: { startsAt: range.start, endsAt: range.end, note: note().trim() || null },
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to sign up."));
    },
    onSuccess: () => {
      toast.success("Shift added");
      props.close(true);
      refreshCurrentPath();
    },
    onError: (err) => prompts.error(err.message),
  });

  return (
    <PanelDialog>
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <PanelDialog.Header
          title="Sign up for a shift"
          subtitle={props.dashboard.venue.name}
          icon="ti ti-user-plus"
          close={() => props.close(false)}
        />
        <PanelDialog.Body>
          <Show when={props.dashboard.venue.signupMode === "both"}>
            <SegmentedControl
              value={mode}
              onChange={setMode}
              options={[
                { value: "shifts", label: "Shift slots", icon: "ti ti-calendar-event" },
                { value: "free", label: "Free time", icon: "ti ti-clock-plus" },
              ]}
            />
          </Show>
          <Show
            when={mode() === "shifts"}
            fallback={
              <div class="grid gap-3">
                <DateRangePicker
                  label="Time"
                  value={freeRange}
                  onChange={setFreeRange}
                  withTime
                  dateConfig={timeZoneDateConfig(props.dashboard.venue.timezone)}
                  durationPresets={[
                    { label: "2h", minutes: 120 },
                    { label: "4h", minutes: 240 },
                    { label: "8h", minutes: 480 },
                  ]}
                />
                <TextInput label="Note" value={note} onInput={setNote} multiline lines={3} />
                <button
                  type="button"
                  class="btn-primary btn-sm justify-center"
                  disabled={freeSignup.loading()}
                  onClick={() => freeSignup.mutate()}
                >
                  <i class={freeSignup.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-plus"} />
                  Add free shift
                </button>
              </div>
            }
          >
            <div class="flex flex-col gap-2">
              <For
                each={availableSlots()}
                fallback={
                  <Placeholder
                    surface="paper"
                    variant="panel"
                    title="No shifts available"
                    description="There are no upcoming shift slots in the current schedule."
                    icon="ti ti-calendar-off"
                  />
                }
              >
                {(slot) => (
                  <div class="paper p-3">
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        <p class="font-medium text-primary">{slot.template.title}</p>
                        <p class="text-xs text-dimmed">
                          {fmt(slot.startsAt)} · {slot.template.startTime}-{slot.template.endTime}
                        </p>
                      </div>
                      <span
                        class={`tag ${slot.full ? "bg-zinc-100 text-dimmed dark:bg-zinc-800" : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"}`}
                      >
                        {slot.full ? "Full" : "Open"}
                      </span>
                    </div>
                    <div class="mt-3">
                      <ProgressBar slot={slot} />
                    </div>
                    <div class="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        class="btn-primary btn-sm"
                        disabled={slot.full || !isSlotActive(slot) || signup.loading()}
                        onClick={() => signup.mutate({ slot })}
                      >
                        Join
                      </button>
                      <button
                        type="button"
                        class="btn-secondary btn-sm"
                        disabled={slot.full || !isSlotActive(slot) || signup.loading()}
                        onClick={() => signup.mutate({ slot, weeks: 4 })}
                      >
                        Join next 4 weeks
                      </button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </PanelDialog.Body>
        <PanelDialog.Footer>
          <div />
          <button type="button" class="btn-secondary btn-sm" onClick={() => props.close(false)}>
            Close
          </button>
        </PanelDialog.Footer>
      </div>
    </PanelDialog>
  );
}

export function ConfirmShiftSignupDialog(props: { slot: UpcomingSlot; timezone: string; close: (confirmed: boolean) => void }) {
  const [skipConfirm, setSkipConfirm] = createSignal(false);
  const confirm = () => {
    if (skipConfirm()) cookies.writeJsonCookie(DOUBLE_CLICK_CONFIRM_COOKIE, true);
    props.close(true);
  };
  return (
    <div class="grid gap-4">
      <div class="rounded-xl bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
        <p class="font-semibold text-primary">{props.slot.template.title}</p>
        <p class="mt-1 text-dimmed">
          {fmt(props.slot.startsAt)} · {fmtTime(props.slot.startsAt, props.timezone)}-{fmtTime(props.slot.endsAt, props.timezone)}
        </p>
        <div class="mt-3">
          <ProgressBar slot={props.slot} />
        </div>
      </div>
      <CheckboxCardInput
        label="Don't show this confirmation again"
        description="Future calendar double-clicks will join shifts directly."
        icon="ti ti-click"
        value={skipConfirm}
        onChange={setSkipConfirm}
        variant="input"
      />
      <div class="flex justify-end gap-2">
        <button type="button" class="btn-secondary btn-sm" onClick={() => props.close(false)}>
          Cancel
        </button>
        <button type="button" class="btn-primary btn-sm" onClick={confirm}>
          Join shift
        </button>
      </div>
    </div>
  );
}
