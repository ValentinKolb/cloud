import { describe, expect, test } from "bun:test";
import serviceWorkerSource from "./service-worker.js" with { type: "text" };

type Listener = (event: Record<string, unknown>) => void;

const loadWorker = (windows: Array<Record<string, unknown>>) => {
  const listeners = new Map<string, Listener>();
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const opened: string[] = [];
  const worker = {
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: () => Promise.resolve(),
    clients: {
      claim: () => Promise.resolve(),
      matchAll: () => Promise.resolve(windows),
      openWindow: (href: string) => {
        opened.push(href);
        return Promise.resolve(null);
      },
    },
    registration: {
      showNotification: (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
        return Promise.resolve();
      },
    },
  };
  new Function("self", serviceWorkerSource)(worker);
  return { listeners, opened, shown };
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

const notificationClickEvent = (targetHref: string) => {
  let completion: Promise<unknown> | null = null;
  let closed = false;
  return {
    event: {
      notification: {
        data: { targetHref },
        close: () => {
          closed = true;
        },
      },
      waitUntil: (promise: Promise<unknown>) => {
        completion = promise;
      },
    },
    completion: () => completion,
    closed: () => closed,
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

  test("shows the OS notification instead of messaging a hidden Cloud client", async () => {
    const messages: unknown[] = [];
    const hiddenClient = {
      focused: false,
      visibilityState: "hidden",
      postMessage: (value: unknown) => messages.push(value),
    };
    const { listeners, shown } = loadWorker([hiddenClient]);
    const push = pushEvent({ type: "cloud-notification", eventId: "hidden-event", title: "Ready", targetHref: "/app/assistant" });

    listeners.get("push")!(push.event);
    await push.completion();

    expect(messages).toEqual([]);
    expect(shown).toHaveLength(1);
  });

  test("focuses an already open exact target when its notification is clicked", async () => {
    let focusCount = 0;
    const targetClient = {
      url: "https://cloud.example/app/assistant?conversation=one",
      focus: () => {
        focusCount += 1;
        return Promise.resolve(targetClient);
      },
    };
    const { listeners, opened } = loadWorker([targetClient]);
    const click = notificationClickEvent("/app/assistant?conversation=one");

    listeners.get("notificationclick")!(click.event);
    await click.completion();

    expect(click.closed()).toBe(true);
    expect(focusCount).toBe(1);
    expect(opened).toEqual([]);
  });

  test("opens the exact target when no Cloud window exists", async () => {
    const { listeners, opened } = loadWorker([]);
    const click = notificationClickEvent("/app/assistant?conversation=two");

    listeners.get("notificationclick")!(click.event);
    await click.completion();

    expect(click.closed()).toBe(true);
    expect(opened).toEqual(["/app/assistant?conversation=two"]);
  });

  test("ignores malformed or cross-origin targets", () => {
    const { listeners, shown } = loadWorker([]);
    const push = pushEvent({ type: "cloud-notification", eventId: crypto.randomUUID(), title: "Unsafe", targetHref: "//example.test" });

    listeners.get("push")!(push.event);

    expect(push.completion()).toBeNull();
    expect(shown).toEqual([]);
  });
});
