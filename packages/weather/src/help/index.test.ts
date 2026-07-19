import { describe, expect, test } from "bun:test";
import { weatherHelp } from ".";

describe("weatherHelp", () => {
  test("serves the existing Weather help as Markdown", async () => {
    expect(weatherHelp.manifest.map((document) => document.id)).toEqual(["weather-start", "weather-read", "weather-troubleshooting"]);

    const response = await weatherHelp.router.request("/weather-start");
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.markdown).toContain("Weather tracks saved locations");
    expect(payload.markdown).toContain("Location search is limited to German cities");
    expect(payload.html).toContain('<h2 id="use-weather" class="help-section-title"');
    expect(payload.html).toContain("<span>Use Weather</span>");

    const readResponse = await weatherHelp.router.request("/weather-read");
    const readPayload = await readResponse.json();
    expect(readPayload.markdown).toContain("Choose the forecast section");

    const troubleshootingResponse = await weatherHelp.router.request("/weather-troubleshooting");
    const troubleshootingPayload = await troubleshootingResponse.json();
    expect(troubleshootingPayload.markdown).toContain("Search currently targets German cities");
  });
});
