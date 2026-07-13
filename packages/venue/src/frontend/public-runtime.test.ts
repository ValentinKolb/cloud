// fallow-ignore-file unused-file
import { describe, expect, test } from "bun:test";
import {
  buildPublicVenueFeedbackUrl,
  buildPublicVenueUrl,
  parseVenuePublicDisplayHeight,
  resolveVenuePublicOrigin,
} from "./public-runtime";

describe("Venue public page runtime", () => {
  test("parses only the supported full display value", () => {
    expect(parseVenuePublicDisplayHeight("full")).toBe("full");
    expect(parseVenuePublicDisplayHeight("scroll")).toBe("scroll");
    expect(parseVenuePublicDisplayHeight("anything")).toBe("scroll");
  });

  test("keeps the default public URL clean", () => {
    expect(buildPublicVenueUrl("https://cloud.example", "student-cafe")).toBe("https://cloud.example/app/venue/public/student-cafe");
  });

  test("adds the full display query and builds a dedicated feedback URL", () => {
    expect(buildPublicVenueUrl("https://cloud.example", "student-cafe", { height: "full" })).toBe(
      "https://cloud.example/app/venue/public/student-cafe?height=full",
    );
    expect(buildPublicVenueFeedbackUrl("https://cloud.example", "student-cafe")).toBe(
      "https://cloud.example/app/venue/public/student-cafe/feedback",
    );
  });

  test("prefers the configured external app origin over the internal request origin", () => {
    expect(resolveVenuePublicOrigin("cloud.example", "http://app-venue:3000")).toBe("https://cloud.example");
    expect(resolveVenuePublicOrigin("localhost:3000", "http://app-venue:3000")).toBe("http://localhost:3000");
    expect(resolveVenuePublicOrigin("", "http://app-venue:3000")).toBe("http://app-venue:3000");
  });
});
