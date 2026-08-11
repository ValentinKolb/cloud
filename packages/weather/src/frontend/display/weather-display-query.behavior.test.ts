import { describe, expect, test } from "bun:test";
import { createComponent } from "solid-js";
import { isServer, render } from "solid-js/web";
import { createDomTestHarness } from "../../../../ui/test/dom";
import type { WeatherDataPayload } from "../../contracts";
import { createWeatherDisplayQuery } from "./weather-display-query";

const forecast = (temperature: number): WeatherDataPayload => ({
  current: {
    temperature,
    icon: "clear-day",
    cloudCover: 0,
    windSpeed: 1,
    windGust: null,
    windDirection: null,
    humidity: 50,
    precipitation: 0,
    pressure: 1_013,
    visibility: 10_000,
    dewPoint: 5,
    sunshine: 60,
    stationName: "Test",
    timestamp: "2026-08-11T10:00:00.000Z",
  },
  hourly: [],
  daily: [],
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("Weather display query", () => {
  if (isServer) {
    test.skip("runs with browser export conditions", () => {});
    return;
  }

  test("keeps SSR last-good data across failure, recovers, and aborts on disposal", async () => {
    const dom = createDomTestHarness();
    const originalFetch = globalThis.fetch;
    const requests: Array<{ signal: AbortSignal; response: ReturnType<typeof deferred<Response>> }> = [];
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const response = deferred<Response>();
      requests.push({ signal: (init?.signal ?? request?.signal) as AbortSignal, response });
      return response.promise;
    }) as typeof fetch;

    let weather!: ReturnType<typeof createWeatherDisplayQuery>;
    const dispose = render(() => {
      weather = createWeatherDisplayQuery({ lat: "48", lon: "9", initialData: forecast(12) });
      return dom.document.createTextNode("");
    }, dom.root);
    await flush();
    expect(requests).toHaveLength(0);

    const failed = weather.refresh();
    await flush();
    requests[0]!.response.resolve(Response.json({ message: "provider down" }, { status: 503 }));
    await failed;
    expect(weather.data()?.current.temperature).toBe(12);
    expect(weather.error()?.message).toBe("provider down");

    const recovered = weather.refresh();
    await flush();
    requests[1]!.response.resolve(Response.json(forecast(18)));
    await recovered;
    expect(weather.data()?.current.temperature).toBe(18);
    expect(weather.error()).toBeNull();

    void weather.refresh();
    await flush();
    const pending = requests[2]!;
    dispose();
    expect(pending.signal.aborted).toBe(true);
    dom.cleanup();
    globalThis.fetch = originalFetch;
  });

  test("treats a null SSR snapshot as exact until explicitly refreshed", async () => {
    const dom = createDomTestHarness();
    const originalFetch = globalThis.fetch;
    const requests: Array<ReturnType<typeof deferred<Response>>> = [];
    globalThis.fetch = ((_input: string | URL | Request, _init?: RequestInit) => {
      const response = deferred<Response>();
      requests.push(response);
      return response.promise;
    }) as typeof fetch;

    let weather!: ReturnType<typeof createWeatherDisplayQuery>;
    const dispose = render(() => {
      weather = createWeatherDisplayQuery({ lat: "48", lon: "9", initialData: null });
      return dom.document.createTextNode("");
    }, dom.root);
    await flush();

    expect(weather.data()).toBeNull();
    expect(weather.loading()).toBe(false);
    expect(requests).toHaveLength(0);

    const refreshed = weather.refresh();
    await flush();
    expect(requests).toHaveLength(1);
    requests[0]!.resolve(Response.json(forecast(18)));
    await refreshed;
    expect(weather.data()?.current.temperature).toBe(18);

    dispose();
    dom.cleanup();
    globalThis.fetch = originalFetch;
  });

  test("starts the display clock on mount and stops it on disposal", async () => {
    const dom = createDomTestHarness();
    const { default: PublicWeatherDisplay } = await import("./PublicWeatherDisplay.island");
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    let clockTick: (() => void) | undefined;
    const cleared: Array<ReturnType<typeof setInterval>> = [];
    const intervalId = 42 as unknown as ReturnType<typeof setInterval>;
    globalThis.setInterval = ((handler: TimerHandler, delay?: number) => {
      expect(delay).toBe(30_000);
      expect(typeof handler).toBe("function");
      clockTick = handler as () => void;
      return intervalId;
    }) as unknown as typeof setInterval;
    globalThis.clearInterval = ((id: ReturnType<typeof setInterval>) => {
      cleared.push(id);
    }) as typeof clearInterval;

    let dispose: (() => void) | undefined;
    try {
      const initialNow = "2026-08-11T10:00:00.000Z";
      dispose = render(
        () =>
          createComponent(PublicWeatherDisplay, {
            lat: "48",
            lon: "9",
            location: "Test",
            state: null,
            initialData: forecast(12),
            initialNow,
            zoom: 1,
            detail: false,
            refreshSeconds: 60,
          }),
        dom.root,
      );

      expect(clockTick).toBeDefined();
      expect(dom.document.querySelector("time")?.getAttribute("datetime")).toBe(initialNow);
      clockTick!();
      await flush();
      expect(dom.document.querySelector("time")?.getAttribute("datetime")).not.toBe(initialNow);

      dispose();
      dispose = undefined;
      expect(cleared).toContain(intervalId);
    } finally {
      dispose?.();
      dom.cleanup();
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });
});
