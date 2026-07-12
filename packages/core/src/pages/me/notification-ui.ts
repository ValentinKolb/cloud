import type { NotificationDeliveryStatus } from "@valentinkolb/cloud/contracts";

export type NotificationChannelAvailability = {
  enabled: boolean;
  description?: string;
};

export const notificationChannelAvailability = (registered: boolean): NotificationChannelAvailability => {
  if (!registered) return { enabled: false, description: "This channel is currently unavailable." };
  return { enabled: true };
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
