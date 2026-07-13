// fallow-ignore-file unused-file
import { describe, expect, test } from "bun:test";
import {
  buildPublicVenueFeedbackUrl,
  buildPublicVenueUrl,
  parseVenuePublicDisplayHeight,
  parseVenuePublicRefresh,
  resolveVenuePublicOrigin,
  venuePublicRefreshBackoffMs,
} from "./public-runtime";

describe("Venue public page runtime", () => {
  test("parses only the supported full display value", () => {
    expect(parseVenuePublicDisplayHeight("full")).toBe("full");
    expect(parseVenuePublicDisplayHeight("scroll")).toBe("scroll");
    expect(parseVenuePublicDisplayHeight("anything")).toBe("scroll");
  });

  test("enables live refresh only for the explicit true query value", () => {
    expect(parseVenuePublicRefresh("true")).toBe(true);
    expect(parseVenuePublicRefresh("false")).toBe(false);
    expect(parseVenuePublicRefresh("1")).toBe(false);
    expect(parseVenuePublicRefresh(undefined)).toBe(false);
  });

  test("keeps the default public URL clean", () => {
    expect(buildPublicVenueUrl("https://cloud.example", "student-cafe")).toBe("https://cloud.example/app/venue/public/student-cafe");
  });

  test("adds the full display query and builds a dedicated feedback URL", () => {
    expect(buildPublicVenueUrl("https://cloud.example", "student-cafe", { height: "full", refresh: true })).toBe(
      "https://cloud.example/app/venue/public/student-cafe?height=full&refresh=true",
    );
    expect(buildPublicVenueFeedbackUrl("https://cloud.example", "student-cafe")).toBe(
      "https://cloud.example/app/venue/public/student-cafe/feedback",
    );
  });

  test("backs off failed refreshes without exceeding one minute", () => {
    expect(venuePublicRefreshBackoffMs(0)).toBe(15_000);
    expect(venuePublicRefreshBackoffMs(1)).toBe(30_000);
    expect(venuePublicRefreshBackoffMs(2)).toBe(60_000);
    expect(venuePublicRefreshBackoffMs(20)).toBe(60_000);
  });

  test("prefers the configured external app origin over the internal request origin", () => {
    expect(resolveVenuePublicOrigin("cloud.example", "http://app-venue:3000")).toBe("https://cloud.example");
    expect(resolveVenuePublicOrigin("localhost:3000", "http://app-venue:3000")).toBe("http://localhost:3000");
    expect(resolveVenuePublicOrigin("", "http://app-venue:3000")).toBe("http://app-venue:3000");
  });
});
