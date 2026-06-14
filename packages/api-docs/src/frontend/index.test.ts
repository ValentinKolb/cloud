import { describe, expect, test } from "bun:test";
import { buildScalarSources } from "./sources";

describe("buildScalarSources", () => {
  test("returns sorted safe OpenAPI sources", () => {
    expect(
      buildScalarSources([
        { id: "weather", name: "Weather", openapi: "/api/weather/openapi.json" },
        { id: "accounts", name: "Accounts", openapi: "https://docs.example.com/accounts.json" },
        { id: "quotes", name: "Quotes" },
      ]),
    ).toEqual([
      { slug: "accounts", title: "Accounts", url: "https://docs.example.com/accounts.json" },
      { slug: "weather", title: "Weather", url: "/api/weather/openapi.json" },
    ]);
  });

  test("drops duplicate or unsafe sources", () => {
    expect(
      buildScalarSources([
        { id: "weather", name: "Weather", openapi: "/api/weather/openapi.json" },
        { id: "weather", name: "Duplicate Weather", openapi: "/api/weather-v2/openapi.json" },
        { id: "bad", name: "Bad", openapi: "javascript:alert(1)" },
        { id: " ", name: "Blank", openapi: "/api/blank/openapi.json" },
      ]),
    ).toEqual([{ slug: "weather", title: "Weather", url: "/api/weather/openapi.json" }]);
  });
});
