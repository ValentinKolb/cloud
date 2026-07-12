const PAYLOAD_TYPE = "cloud-notification";
const TARGET_ORIGIN = "https://cloud.invalid";

const safeTargetHref = (value) => {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const target = new URL(value, TARGET_ORIGIN);
    return target.origin === TARGET_ORIGIN && `${target.pathname}${target.search}${target.hash}` === value ? value : null;
  } catch {
    return null;
  }
};

const parsePayload = (event) => {
  if (!event.data) return null;
  try {
    const value = event.data.json();
    if (
      value?.type !== PAYLOAD_TYPE ||
      typeof value.eventId !== "string" ||
      typeof value.title !== "string" ||
      (value.targetHref !== undefined && safeTargetHref(value.targetHref) === null)
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
};

const targetHref = (value) => safeTargetHref(value) ?? "/";

const postToVisibleClient = (client, payload) =>
  new Promise((resolve) => {
    const channel = new MessageChannel();
    let settled = false;
    const finish = (received) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      channel.port1.close();
      resolve(received);
    };
    const timeout = setTimeout(() => finish(false), 500);
    channel.port1.onmessage = () => finish(true);
    try {
      client.postMessage(payload, [channel.port2]);
    } catch {
      finish(false);
    }
  });

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  const payload = parsePayload(event);
  if (!payload) return;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const visible = windows
        .filter((client) => client.visibilityState === "visible")
        .sort((left, right) => Number(Boolean(right.focused)) - Number(Boolean(left.focused)));
      for (const client of visible) {
        if (await postToVisibleClient(client, payload)) return;
      }
      await self.registration.showNotification(payload.title, {
        body: "Open Cloud to view.",
        icon: "/branding/logo",
        tag: payload.eventId,
        data: { targetHref: targetHref(payload.targetHref) },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = targetHref(event.notification.data?.targetHref);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const exact = windows.find((client) => {
        const url = new URL(client.url);
        return `${url.pathname}${url.search}${url.hash}` === target;
      });
      if (exact) return exact.focus();

      const existing = windows[0];
      if (existing) {
        await existing.navigate(target);
        return existing.focus();
      }
      return self.clients.openWindow(target);
    })(),
  );
});
