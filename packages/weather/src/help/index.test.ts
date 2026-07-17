import { describe, expect, test } from "bun:test";
import { weatherHelp } from ".";

describe("weatherHelp", () => {
  test("serves the existing Weather help as Markdown", async () => {
    expect(weatherHelp.manifest.map((document) => document.id)).toEqual(["weather-start"]);

    const response = await weatherHelp.router.request("/weather-start");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.markdown).toContain("Weather tracks saved locations");
    expect(payload.markdown).toContain("Location search is limited to German cities");
    expect(payload.html).toContain("<h2>Use Weather</h2>");
  });
});
