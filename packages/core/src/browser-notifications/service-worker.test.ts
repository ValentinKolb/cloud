import { describe, expect, test } from "bun:test";
import serviceWorkerSource from "./service-worker.js" with { type: "text" };

type Listener = (event: Record<string, unknown>) => void;

const loadWorker = (windows: Array<Record<string, unknown>>) => {
  const listeners = new Map<string, Listener>();
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const worker = {
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: () => Promise.resolve(),
    clients: {
      claim: () => Promise.resolve(),
      matchAll: () => Promise.resolve(windows),
      openWindow: () => Promise.resolve(null),
    },
    registration: {
      showNotification: (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
        return Promise.resolve();
      },
    },
  };
  new Function("self", serviceWorkerSource)(worker);
  return { listeners, shown };
};

const pushEvent = (payload: unknown) => {
  let completion: Promise<unknown> | null = null;
  return {
    event: {
      data: { json: () => payload },
      waitUntil: (promise: Promise<unknown>) => {
        completion = promise;
      },
    },
    completion: () => completion,
  };
};

describe("browser notification service worker", () => {
  test("uses one visible Cloud client instead of showing a duplicate OS notification", async () => {
    const messages: unknown[] = [];
    const visibleClient = {
      focused: true,
      visibilityState: "visible",
      postMessage: (value: unknown) => messages.push(value),
    };
    const { listeners, shown } = loadWorker([visibleClient]);
    const payload = { type: "cloud-notification", eventId: crypto.randomUUID(), title: "Ready", targetHref: "/app/assistant" };
    const push = pushEvent(payload);

    listeners.get("push")!(push.event);
    await push.completion();

    expect(messages).toEqual([payload]);
    expect(shown).toEqual([]);
  });

  test("shows a minimal deep-linked OS notification without a visible client", async () => {
    const { listeners, shown } = loadWorker([]);
    const eventId = crypto.randomUUID();
    const push = pushEvent({ type: "cloud-notification", eventId, title: "Ready", targetHref: "/app/assistant/chats/1" });

    listeners.get("push")!(push.event);
    await push.completion();

    expect(shown).toEqual([
      {
        title: "Ready",
        options: {
          body: "Open Cloud to view.",
          icon: "/branding/logo",
          tag: eventId,
          data: { targetHref: "/app/assistant/chats/1" },
        },
      },
    ]);
  });

  test("ignores malformed or cross-origin targets", () => {
    const { listeners, shown } = loadWorker([]);
    const push = pushEvent({ type: "cloud-notification", eventId: crypto.randomUUID(), title: "Unsafe", targetHref: "//example.test" });

    listeners.get("push")!(push.event);

    expect(push.completion()).toBeNull();
    expect(shown).toEqual([]);
  });
});
