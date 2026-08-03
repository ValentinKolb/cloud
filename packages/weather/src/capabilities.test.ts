import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { ok } from "@k2b/stdlib";
import type { CapabilityExecutionContext, User } from "@valentinkolb/cloud/contracts";
import { audit, weatherService } from "@valentinkolb/cloud/services";
import { decodeWeatherCapabilityCursor, weatherCapabilities } from "./capabilities";

const userId = "11111111-1111-4111-8111-111111111111";
const locationId = "22222222-2222-4222-8222-222222222222";

const user = {
  id: userId,
  uid: "weather-user",
  roles: ["user"],
  provider: "local",
  profile: "user",
  givenname: "Weather",
  sn: "User",
  displayName: "Weather User",
  mail: "weather@example.test",
  avatarHash: null,
  ipa: null,
  accountExpires: null,
  lastLoginLocal: null,
  memberofGroup: [],
  memberofGroupIds: [],
  manages: [],
  managesGroupIds: [],
} satisfies User;

const userContext = {
  actor: { kind: "user", user },
  accessSubject: { type: "user", userId },
  user,
  signal: new AbortController().signal,
} satisfies CapabilityExecutionContext;

const serviceAccountContext = {
  actor: {
    kind: "service_account",
    serviceAccount: {
      id: "33333333-3333-4333-8333-333333333333",
      name: "Weather resource account",
      kind: "resource_bound",
      status: "active",
      delegatedUserId: null,
      appId: "weather",
      resourceType: "location",
      resourceId: locationId,
      createdBy: null,
      createdAt: "2026-08-01T00:00:00.000Z",
    },
    delegatedUser: null,
    scopes: ["read"],
  },
  accessSubject: {
    type: "service_account",
    serviceAccountId: "33333333-3333-4333-8333-333333333333",
  },
  user: null,
  signal: new AbortController().signal,
} satisfies CapabilityExecutionContext;

const location = {
  id: locationId,
  name: "Ulm",
  state: "Baden-Württemberg",
  lat: 48.4,
  lon: 9.99,
};

afterEach(() => mock.restore());

describe("weather capabilities", () => {
  test("declares the complete local v1 surface", () => {
    expect(Object.keys(weatherCapabilities.types)).toEqual(["location"]);
    expect(Object.keys(weatherCapabilities.queries).sort()).toEqual([
      "city.search",
      "forecast.current",
      "forecast.get",
      "location.get",
      "location.list",
      "location.search",
    ]);
    expect(Object.keys(weatherCapabilities.actions).sort()).toEqual(["location.create", "location.delete"]);
    const createAction = weatherCapabilities.actions["location.create"];
    expect(createAction).toMatchObject({
      destructive: false,
      openWorld: false,
      idempotency: "none",
    });
    expect("target" in createAction).toBeFalse();
    expect(weatherCapabilities.actions["location.delete"]).toMatchObject({
      destructive: true,
      openWorld: false,
      idempotency: "none",
    });
    expect("review" in weatherCapabilities.actions["location.create"]).toBeFalse();
    expect(weatherCapabilities.actions["location.delete"].review).toBeFunction();
  });

  test("keeps inputs closed and bounded", () => {
    expect(weatherCapabilities.queries["location.list"].input.safeParse({ limit: 101 }).success).toBeFalse();
    expect(
      weatherCapabilities.queries["forecast.get"].input.safeParse({
        source: { kind: "coordinates", lat: 48.4, lon: 9.99, unexpected: true },
      }).success,
    ).toBeFalse();
    expect(
      weatherCapabilities.queries["forecast.get"].input.safeParse({
        source: { kind: "saved", locationId },
      }).success,
    ).toBeTrue();
    expect(
      weatherCapabilities.actions["location.create"].input.safeParse({
        name: location.name,
        lat: location.lat,
        lon: location.lon,
        unexpected: true,
      }).success,
    ).toBeFalse();
  });

  test("reviews location deletion without removing it", async () => {
    spyOn(weatherService.location.saved, "get").mockResolvedValue(location);
    const remove = spyOn(weatherService.location.saved, "remove");
    const review = weatherCapabilities.actions["location.delete"].review;
    if (!review) throw new Error("Location delete review missing");

    const result = await review({ locationId }, userContext);

    expect(result).toMatchObject({ ok: true, data: { message: "Permanently delete saved weather location Ulm." } });
    expect(remove).not.toHaveBeenCalled();
  });

  test("accepts only opaque v1 page cursors", () => {
    const cursor = Buffer.from(JSON.stringify({ v: 1, page: 3 }), "utf8").toString("base64url");
    expect(decodeWeatherCapabilityCursor(cursor)).toEqual({ ok: true, data: 3 });
    expect(decodeWeatherCapabilityCursor("not-a-cursor").ok).toBeFalse();
  });

  test("lists only the access-subject user's page", async () => {
    const list = spyOn(weatherService.location.saved, "list").mockResolvedValue({
      items: [location],
      page: 2,
      perPage: 1,
      total: 3,
      hasNext: true,
    });
    const cursor = Buffer.from(JSON.stringify({ v: 1, page: 2 }), "utf8").toString("base64url");

    const result = await weatherCapabilities.queries["location.list"].run({ limit: 1, cursor }, userContext);

    expect(list).toHaveBeenCalledWith({ userId, pagination: { page: 2, perPage: 1 } });
    expect(result).toMatchObject({
      ok: true,
      data: {
        data: [location],
        refs: [{ type: "weather.location", id: locationId }],
        page: { hasMore: true },
      },
    });
  });

  test("fails unsupported actors closed before reading saved locations", async () => {
    const get = spyOn(weatherService.location.saved, "get");

    const result = await weatherCapabilities.queries["location.get"].run({ locationId }, serviceAccountContext);

    expect(get).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, error: { code: "FORBIDDEN", status: 403 } });
  });

  test("does not distinguish a missing location from another user's location", async () => {
    const get = spyOn(weatherService.location.saved, "get").mockResolvedValue(null);

    const result = await weatherCapabilities.queries["location.get"].run({ locationId }, userContext);

    expect(get).toHaveBeenCalledWith({ id: locationId, userId });
    expect(result).toEqual({
      ok: false,
      error: { code: "NOT_FOUND", message: "Location not found", status: 404 },
    });
  });

  test("resolves an owned saved location through the existing forecast service", async () => {
    const getLocation = spyOn(weatherService.location.saved, "get").mockResolvedValue(location);
    const getCurrent = spyOn(weatherService.forecast.current, "get").mockResolvedValue({
      temperature: 22,
      icon: "clear-day",
      cloudCover: 10,
      windSpeed: 8,
      windGust: null,
      windDirection: 180,
      humidity: 55,
      precipitation: 0,
      pressure: 1015,
      visibility: 20_000,
      dewPoint: 12,
      sunshine: 60,
      stationName: "Ulm",
      timestamp: "2026-08-01T12:00:00.000Z",
    });

    const result = await weatherCapabilities.queries["forecast.current"].run({ source: { kind: "saved", locationId } }, userContext);

    expect(getLocation).toHaveBeenCalledWith({ id: locationId, userId });
    expect(getCurrent).toHaveBeenCalledWith({ lat: String(location.lat), lon: String(location.lon) });
    expect(result).toMatchObject({
      ok: true,
      data: {
        refs: [{ type: "weather.location", id: locationId }],
        links: [{ rel: "open", href: `/app/weather/${locationId}` }],
      },
    });
  });

  test("audits allowed creates and denied deletes", async () => {
    const create = spyOn(weatherService.location.saved, "create").mockResolvedValue(ok(location));
    const recordAllowed = spyOn(audit, "recordResultAfterSideEffect").mockImplementation(async ({ result }) => result);
    const recordDenied = spyOn(audit, "recordResult").mockImplementation(async ({ result }) => result);

    const created = await weatherCapabilities.actions["location.create"].run(
      { name: location.name, state: location.state ?? undefined, lat: location.lat, lon: location.lon },
      userContext,
    );
    const denied = await weatherCapabilities.actions["location.delete"].run({ locationId }, serviceAccountContext);

    expect(create).toHaveBeenCalledWith({
      userId,
      data: { name: location.name, state: location.state, lat: location.lat, lon: location.lon },
    });
    expect(created).toMatchObject({ ok: true, data: { data: location } });
    expect(denied).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(recordAllowed).toHaveBeenCalledWith(expect.objectContaining({ action: "weather.capability.location.create" }));
    expect(recordDenied).toHaveBeenCalledWith(expect.objectContaining({ action: "weather.capability.location.delete" }));
  });
});
