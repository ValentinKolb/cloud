import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { notificationTargetMatchesLocation } from "../browser/notification-target";
import { browserNotificationClient } from "../browser/notifications";

type CloudNotificationMessage = {
  type: "cloud-notification";
  eventId: string;
  title: string;
  targetHref?: string;
};

const isNotificationMessage = (value: unknown): value is CloudNotificationMessage => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.type === "cloud-notification" &&
    typeof candidate.eventId === "string" &&
    typeof candidate.title === "string" &&
    (candidate.targetHref === undefined ||
      (typeof candidate.targetHref === "string" && candidate.targetHref.startsWith("/") && !candidate.targetHref.startsWith("//")))
  );
};

export default function BrowserNotifications() {
  const [notification, setNotification] = createSignal<CloudNotificationMessage | null>(null);
  const seen = new Set<string>();

  onMount(() => {
    void browserNotificationClient.refreshExisting().catch((error) => {
      console.warn("[notifications] Failed to refresh the browser endpoint", error);
    });

    const onMessage = (event: MessageEvent<unknown>) => {
      if (!isNotificationMessage(event.data) || seen.has(event.data.eventId)) return;
      seen.add(event.data.eventId);
      if (event.data.targetHref && notificationTargetMatchesLocation(event.data.targetHref, window.location.href)) return;
      setNotification(event.data);
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    onCleanup(() => navigator.serviceWorker?.removeEventListener("message", onMessage));
  });

  return (
    <Show when={notification()} keyed>
      {(item) => (
        <aside
          class="paper fixed bottom-3 left-3 right-3 z-40 flex items-start gap-3 p-3 shadow-lg sm:left-auto sm:w-96"
          aria-live="polite"
          aria-label="New notification"
        >
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-500/10 text-blue-600 dark:bg-blue-400/15 dark:text-blue-400">
            <i class="ti ti-bell" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-primary">{item.title}</p>
            <p class="mt-0.5 text-xs text-dimmed">A related item is ready.</p>
            {item.targetHref && (
              <a
                href={item.targetHref}
                class="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                Open
                <i class="ti ti-arrow-right" />
              </a>
            )}
          </div>
          <button
            type="button"
            class="btn-icon-ghost btn-xs shrink-0"
            aria-label="Dismiss notification"
            title="Dismiss"
            onClick={() => setNotification(null)}
          >
            <i class="ti ti-x" />
          </button>
        </aside>
      )}
    </Show>
  );
}
