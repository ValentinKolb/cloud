import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { geoService } from "./geo";

afterEach(() => mock.restore());

describe("geo service", () => {
  test("validates upstream places before bounded local pagination", async () => {
    const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          places: [
            {
              name: "Ulm",
              latitude: 48.4,
              longitude: 9.99,
              country_code: "DE",
              admin1_code: "Baden-Württemberg",
              feature_class: "P",
            },
            { name: "Invalid coordinates", latitude: 900, longitude: 9.99, country_code: "DE", feature_class: "P" },
            { name: "Not a city", latitude: 48.5, longitude: 10, country_code: "DE", feature_class: "A" },
          ],
        }),
      ),
    );

    const result = await geoService.place.list({
      baseUrl: "https://geo.example.test/",
      pagination: { page: 1, perPage: 1 },
      filter: { query: "Ulm", country: "DE", featureClass: "P" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      data: {
        items: [
          {
            name: "Ulm",
            lat: 48.4,
            lon: 9.99,
            country: "DE",
            state: "Baden-Württemberg",
            featureClass: "P",
            featureCode: undefined,
          },
        ],
        page: 1,
        perPage: 1,
        total: 1,
        hasNext: false,
      },
    });
  });

  test("fails oversized and malformed upstream responses without leaking details", async () => {
    spyOn(globalThis, "fetch").mockResolvedValue(new Response("not-json", { headers: { "content-length": String(256 * 1024 + 1) } }));

    const result = await geoService.place.list({
      baseUrl: "https://geo.example.test",
      filter: { query: "Ulm" },
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "GEO_UNAVAILABLE", message: "Geo service is unavailable", status: 500 },
    });
  });

  test("combines caller cancellation with the fixed request timeout", async () => {
    const controller = new AbortController();
    let outboundSignal: AbortSignal | undefined;
    spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      outboundSignal = init?.signal ?? undefined;
      return new Response(JSON.stringify({ places: [] }));
    });

    const result = await geoService.place.list({
      baseUrl: "https://geo.example.test",
      signal: controller.signal,
      filter: { query: "Ulm" },
    });
    controller.abort();

    expect(result.ok).toBeTrue();
    expect(outboundSignal).toBeInstanceOf(AbortSignal);
    expect(outboundSignal?.aborted).toBeTrue();
  });
});
