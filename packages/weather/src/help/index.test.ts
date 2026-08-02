import { describe, expect, test } from "bun:test";
import { weatherHelp } from ".";

describe("weatherHelp", () => {
  test("owns the existing Weather help as Markdown", () => {
    expect(weatherHelp.documents.map((document) => document.id)).toEqual(["weather-start", "weather-read", "weather-troubleshooting"]);

    expect(weatherHelp.getMarkdown("weather-start")).toContain("Weather tracks saved locations");
    expect(weatherHelp.getMarkdown("weather-start")).toContain("Location search is limited to German cities");
    const startHtml = weatherHelp.documents.find((document) => document.id === "weather-start")?.html;
    expect(startHtml).toContain('<h2 id="use-weather" class="help-section-title"');
    expect(startHtml).toContain("<span>Use Weather</span>");
    expect(weatherHelp.getMarkdown("weather-read")).toContain("Choose the forecast section");
    expect(weatherHelp.getMarkdown("weather-troubleshooting")).toContain("Search currently targets German cities");
  });
});
