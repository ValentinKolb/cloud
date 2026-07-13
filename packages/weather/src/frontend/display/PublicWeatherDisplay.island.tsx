import { timing } from "@valentinkolb/stdlib";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "../../api/client";
import { type WeatherDataPayload, WeatherDataSchema } from "../../contracts";
import { DetailDisplayView, DisplayUnavailable, SimpleDisplayView } from "./DisplayViews";
import { displayRefreshBackoffMs } from "./runtime";

const DISPLAY_REQUEST_TIMEOUT_MS = 10_000;

const readResponseError = async (response: Response): Promise<string> => {
  const body: unknown = await response.json().catch(() => null);
  return body && typeof body === "object" && "message" in body && typeof body.message === "string"
    ? body.message
    : "Could not refresh weather data";
};

const fetchWeather = async (lat: string, lon: string, parentSignal: AbortSignal): Promise<WeatherDataPayload> => {
  const request = new AbortController();
  let timedOut = false;
  const abort = () => request.abort();
  if (parentSignal.aborted) abort();
  else parentSignal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    abort();
  }, DISPLAY_REQUEST_TIMEOUT_MS);

  try {
    const response = await apiClient.index.$get({ query: { lat, lon } }, { init: { cache: "no-store", signal: request.signal } });
    if (!response.ok) throw new Error(await readResponseError(response));
    return WeatherDataSchema.parse(await response.json());
  } catch (error) {
    if (timedOut) throw new Error("Weather refresh timed out");
    throw error;
  } finally {
    clearTimeout(timeout);
    parentSignal.removeEventListener("abort", abort);
  }
};

type PublicWeatherDisplayProps = {
  lat: string;
  lon: string;
  location: string;
  state: string | null;
  initialData: WeatherDataPayload | null;
  initialNow: string;
  zoom: 1 | 2 | 3;
  detail: boolean;
  refreshSeconds: number;
};

export default function PublicWeatherDisplay(props: PublicWeatherDisplayProps) {
  const [data, setData] = createSignal(props.initialData);
  const [now, setNow] = createSignal(props.initialNow);
  const [refreshedAt, setRefreshedAt] = createSignal<string | null>(null);
  let disposed = false;
  let failures = 0;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let clockTimer: ReturnType<typeof setInterval> | undefined;

  const refresh = mutation.create<WeatherDataPayload, void>({
    mutation: (_, { abortSignal }) => fetchWeather(props.lat, props.lon, abortSignal),
    onSuccess: (nextData) => {
      failures = 0;
      setData(nextData);
      const timestamp = new Date().toISOString();
      setNow(timestamp);
      setRefreshedAt(timestamp);
    },
    onError: (error) => {
      failures += 1;
      console.warn("Weather display refresh failed", error);
    },
  });

  const nextDelay = () => Math.max(1_000, timing.jitter(displayRefreshBackoffMs(props.refreshSeconds, failures), 350));

  const schedule = (delay: number) => {
    if (disposed) return;
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void run(), delay);
  };

  const run = async () => {
    if (disposed) return;
    if (document.hidden) {
      schedule(displayRefreshBackoffMs(props.refreshSeconds, 0));
      return;
    }
    if (refresh.loading()) return;
    await refresh.mutate();
    schedule(nextDelay());
  };

  const handleVisibilityChange = () => {
    if (!document.hidden) schedule(0);
  };

  const handleOnline = () => schedule(0);

  onMount(() => {
    if (typeof document === "undefined") return;
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    clockTimer = setInterval(() => setNow(new Date().toISOString()), 30_000);
    schedule(data() ? displayRefreshBackoffMs(props.refreshSeconds, 0) : 0);
  });

  onCleanup(() => {
    disposed = true;
    if (refreshTimer) clearTimeout(refreshTimer);
    if (clockTimer) clearInterval(clockTimer);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
    }
    refresh.abort();
  });

  const viewProps = () => ({
    data: data()!,
    location: props.location,
    state: props.state,
    zoom: props.zoom,
    now: now(),
    refreshSeconds: props.refreshSeconds,
    refreshedAt: refreshedAt(),
  });

  return (
    <Show
      when={data()}
      fallback={
        <DisplayUnavailable
          message="The forecast provider is not responding right now."
          refreshSeconds={props.refreshSeconds}
          refreshedAt={refreshedAt()}
          retrying
        />
      }
    >
      {props.detail ? <DetailDisplayView {...viewProps()} /> : <SimpleDisplayView {...viewProps()} />}
    </Show>
  );
}
