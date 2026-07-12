import type { BrowserNotificationState } from "@valentinkolb/cloud/browser/notifications";
import type { NotificationDeliveryStatus } from "@valentinkolb/cloud/contracts";

export const BROWSER_NOTIFICATION_STATE_EVENT = "cloud:browser-notification-state";

export type NotificationChannelAvailability = {
  enabled: boolean;
  description?: string;
  warning?: string;
};

export const notificationChannelAvailability = (
  channel: string,
  registered: boolean,
  browserState: BrowserNotificationState | null,
): NotificationChannelAvailability => {
  if (!registered) return { enabled: false, description: "This channel is currently unavailable." };
  if (channel !== "browser") return { enabled: true };
  if (!browserState) return { enabled: false, description: "Checking browser notification status..." };
  if (browserState.enabled) return { enabled: true };
  if (!browserState.supported) {
    return {
      enabled: false,
      description: browserState.reason ?? "Browser notifications are not supported on this device.",
      warning: "Browser notifications are unavailable on this device.",
    };
  }
  if (browserState.permission === "denied") {
    return {
      enabled: false,
      description: "Allow notifications in your browser settings before selecting this channel.",
      warning: "Browser notifications are blocked in this browser.",
    };
  }
  return {
    enabled: false,
    description: "Enable browser notifications on this device above before selecting this channel.",
    warning: "Browser notifications are disabled on this device.",
  };
};

export const announceBrowserNotificationState = (state: BrowserNotificationState): void => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<BrowserNotificationState>(BROWSER_NOTIFICATION_STATE_EVENT, { detail: state }));
};

const isBrowserNotificationState = (value: unknown): value is BrowserNotificationState => {
  if (!value || typeof value !== "object") return false;
  return (
    "supported" in value &&
    typeof value.supported === "boolean" &&
    "permission" in value &&
    (value.permission === "default" || value.permission === "denied" || value.permission === "granted") &&
    "enabled" in value &&
    typeof value.enabled === "boolean" &&
    (!("reason" in value) || value.reason === undefined || typeof value.reason === "string")
  );
};

export const subscribeBrowserNotificationState = (listener: (state: BrowserNotificationState) => void): (() => void) => {
  const receive = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const state: unknown = event.detail;
    if (isBrowserNotificationState(state)) listener(state);
  };
  window.addEventListener(BROWSER_NOTIFICATION_STATE_EVENT, receive);
  return () => window.removeEventListener(BROWSER_NOTIFICATION_STATE_EVENT, receive);
};

const CHANNELS: Record<string, { label: string; icon: string }> = {
  email: { label: "Email", icon: "ti ti-mail" },
  browser: { label: "Browser", icon: "ti ti-bell" },
  none: { label: "Not delivered", icon: "ti ti-bell-off" },
};

export const notificationChannelMeta = (channel: string): { label: string; icon: string } =>
  CHANNELS[channel] ?? {
    label: channel
      .split(/[-_.:]/)
      .filter(Boolean)
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(" "),
    icon: "ti ti-bell",
  };

export const notificationStatusMeta = (status: NotificationDeliveryStatus): { label: string; class: string } => {
  switch (status) {
    case "delivered":
      return { label: "Delivered", class: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" };
    case "failed":
      return { label: "Failed", class: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" };
    case "suppressed":
      return { label: "Not sent", class: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" };
    case "sending":
      return { label: "Sending", class: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" };
    case "pending":
      return { label: "Pending", class: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" };
    case "deferred":
      return { label: "Waiting", class: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" };
  }
};
