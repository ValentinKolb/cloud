import { describe, expect, test } from "bun:test";
import { newWeatherLocationShortId, WEATHER_LOCATION_SHORT_ID_PATTERN, withWeatherLocationShortId } from "./short-id";

describe("Weather location short IDs", () => {
  test("generates readable six-character IDs", () => {
    expect(newWeatherLocationShortId()).toMatch(WEATHER_LOCATION_SHORT_ID_PATTERN);
  });

  test("retries Bun unique violations for the Weather index", async () => {
    let attempts = 0;
    const result = await withWeatherLocationShortId(async (shortId) => {
      attempts++;
      if (attempts === 1) throw { errno: "23505", constraint: "idx_weather_locations_short_id" };
      return shortId;
    });

    expect(attempts).toBe(2);
    expect(result).toMatch(WEATHER_LOCATION_SHORT_ID_PATTERN);
  });

  test("does not hide unrelated database failures", async () => {
    const failure = new Error("database unavailable");
    await expect(withWeatherLocationShortId(async () => Promise.reject(failure))).rejects.toBe(failure);
  });
});
