import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { notificationTargetMatchesLocation } from "../browser/notification-target";
import { browserNotificationClient } from "../browser/notifications";
import { isSafeNotificationTargetHref } from "../contracts/notification-types";

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
    (candidate.targetHref === undefined || (typeof candidate.targetHref === "string" && isSafeNotificationTargetHref(candidate.targetHref)))
  );
};

export default function BrowserNotifications() {
  const [notification, setNotification] = createSignal<CloudNotificationMessage | null>(null);
  const seen = new Set<string>();

  onMount(() => {
    const receive = (value: unknown): boolean => {
      if (!isNotificationMessage(value)) return false;
      if (seen.has(value.eventId)) return true;
      seen.add(value.eventId);
      if (seen.size > 500) seen.delete(seen.values().next().value ?? "");
      if (value.targetHref && notificationTargetMatchesLocation(value.targetHref, window.location.href)) return true;
      setNotification(value);
      return true;
    };

    void browserNotificationClient.refreshExisting().catch((error) => {
      console.warn("[notifications] Failed to refresh the browser endpoint", error);
    });

    const onMessage = (event: MessageEvent<unknown>) => {
      if (!receive(event.data)) return;
      event.ports[0]?.postMessage({ received: true });
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);

    let source: EventSource | null = null;
    const connect = () => {
      if (!("EventSource" in window) || document.visibilityState !== "visible" || source) return;
      source = new EventSource("/api/me/notifications/events");
      source.addEventListener("notification", (event) => {
        if (!(event instanceof MessageEvent) || typeof event.data !== "string") return;
        try {
          receive(JSON.parse(event.data));
        } catch {
          // Ignore malformed live events; durable history remains available.
        }
      });
    };
    const syncVisibility = () => {
      if (document.visibilityState === "visible") connect();
      else {
        source?.close();
        source = null;
      }
    };
    document.addEventListener("visibilitychange", syncVisibility);
    connect();

    onCleanup(() => {
      navigator.serviceWorker?.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", syncVisibility);
      source?.close();
    });
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
