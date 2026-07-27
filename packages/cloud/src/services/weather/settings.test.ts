import { describe, expect, test } from "bun:test";
import { registerSettings, toLegacySettingDefs, validateSettingValue } from "../settings/defaults";
import { WEATHER_SETTINGS } from "./settings";

describe("Weather settings", () => {
  test("can be registered repeatedly from the shared contract", () => {
    const definitions = toLegacySettingDefs(WEATHER_SETTINGS);

    expect(() => registerSettings(definitions)).not.toThrow();
    expect(() => registerSettings(definitions)).not.toThrow();
  });

  test("preserves cache duration limits", () => {
    const cacheMinutes = toLegacySettingDefs(WEATHER_SETTINGS).find((definition) => definition.key === "weather.cache_minutes");

    expect(cacheMinutes).toBeDefined();
    expect(validateSettingValue(cacheMinutes!, 0).ok).toBe(false);
    expect(validateSettingValue(cacheMinutes!, 1)).toEqual({ ok: true, value: 1 });
    expect(validateSettingValue(cacheMinutes!, 1440)).toEqual({ ok: true, value: 1440 });
    expect(validateSettingValue(cacheMinutes!, 1441).ok).toBe(false);
  });
});
