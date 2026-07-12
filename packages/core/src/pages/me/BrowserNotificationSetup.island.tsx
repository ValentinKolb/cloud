import type { BrowserNotificationState } from "@valentinkolb/cloud/browser/notifications";
import { browserNotificationClient } from "@valentinkolb/cloud/browser/notifications";
import { toast } from "@valentinkolb/cloud/ui";
import { createSignal, onMount, Show } from "solid-js";
import { announceBrowserNotificationState } from "./notification-ui";

const statusMeta = (state: BrowserNotificationState | null) => {
  if (!state) return { label: "Checking", class: "tag-neutral" };
  if (!state.supported) return { label: "Unavailable", class: "tag-neutral" };
  if (state.permission === "denied") return { label: "Blocked", class: "tag-danger" };
  if (state.enabled) return { label: "Enabled", class: "tag-success" };
  return { label: "Off", class: "tag-neutral" };
};

export default function BrowserNotificationSetup() {
  const [state, setState] = createSignal<BrowserNotificationState | null>(null);
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const applyState = (next: BrowserNotificationState) => {
    setState(next);
    announceBrowserNotificationState(next);
  };

  onMount(async () => {
    try {
      applyState(await browserNotificationClient.state());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to inspect browser notification support.");
    }
  });

  const enable = async () => {
    setPending(true);
    setError(null);
    try {
      const next = await browserNotificationClient.enable();
      applyState(next);
      if (next.enabled) toast.success("Browser notifications enabled.");
      else if (next.permission === "denied") setError("Permission is blocked. Allow notifications in your browser settings to continue.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to enable browser notifications.");
    } finally {
      setPending(false);
    }
  };

  const disable = async () => {
    setPending(true);
    setError(null);
    try {
      applyState(await browserNotificationClient.disable());
      toast.success("Browser notifications disabled on this device.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to disable browser notifications.");
    } finally {
      setPending(false);
    }
  };

  const status = () => statusMeta(state());

  return (
    <section class="paper p-5 sm:p-6">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex min-w-0 items-start gap-3">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-blue-500/10 text-blue-600 dark:bg-blue-400/15 dark:text-blue-400">
            <i class="ti ti-bell" />
          </span>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-sm font-semibold text-primary">Browser notifications</h2>
              <span class={`tag ${status().class}`}>{status().label}</span>
            </div>
            <p class="mt-1 text-xs leading-relaxed text-dimmed">
              Receive operating-system notifications from this browser when Cloud is in the background or closed.
            </p>
            <Show when={state()?.reason} keyed>
              {(reason) => <p class="mt-2 text-xs text-secondary">{reason}</p>}
            </Show>
            <Show when={error()} keyed>
              {(message) => <p class="mt-2 text-xs text-red-600 dark:text-red-400">{message}</p>}
            </Show>
          </div>
        </div>

        <Show when={state()?.supported && state()?.permission !== "denied"}>
          <button
            type="button"
            class={state()?.enabled ? "btn-secondary btn-sm shrink-0" : "btn-primary btn-sm shrink-0"}
            disabled={pending()}
            onClick={() => void (state()?.enabled ? disable() : enable())}
          >
            <i class={pending() ? "ti ti-loader-2 animate-spin" : state()?.enabled ? "ti ti-bell-off" : "ti ti-bell-plus"} />
            {pending() ? "Working..." : state()?.enabled ? "Disable" : "Enable"}
          </button>
        </Show>
      </div>
    </section>
  );
}
