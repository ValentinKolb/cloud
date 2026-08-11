import { query } from "@k2b/stdlib/solid";
import { apiClient } from "../../api/client";
import { type WeatherDataPayload, WeatherDataSchema } from "../../contracts";

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

export const createWeatherDisplayQuery = (input: { lat: string; lon: string; initialData: WeatherDataPayload | null }) => {
  const source = { lat: input.lat, lon: input.lon };
  return query.create({
    source: () => source,
    initial: { source, data: input.initialData },
    load: ({ lat, lon }, { abortSignal }) => fetchWeather(lat, lon, abortSignal),
  });
};
