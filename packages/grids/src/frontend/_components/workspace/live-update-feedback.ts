import { toast } from "@valentinkolb/cloud/ui";

const NOTIFICATION_COOLDOWN_MS = 10_000;
let lastNotificationAt = 0;

export const notifyWorkspaceLiveUpdateFailure = (scope: string, error: unknown) => {
  console.warn(`Grids ${scope} live updates stopped`, error);

  const now = Date.now();
  if (now - lastNotificationAt < NOTIFICATION_COOLDOWN_MS) return;
  lastNotificationAt = now;

  toast.error("Some workspace data may now be out of date.", {
    title: "Live updates stopped",
    duration: 0,
    action: { label: "Reload", href: window.location.href },
  });
};
