import { describe, expect, test } from "bun:test";
import { VenueDashboardQuerySchema } from "../contracts";
import { sameVenueDashboardSource, venueDashboardRouteScope } from "./dashboard-query";

describe("venue dashboard query scope", () => {
  test("uses the same calendar window for SSR options and browser query input", () => {
    const scope = venueDashboardRouteScope({
      venueId: "11111111-1111-4111-8111-111111111111",
      view: "shifts",
      calendarView: "month",
      calendarDate: "2026-08-10",
      feedbackDays: 30,
      feedbackSearch: "",
    });

    expect(scope.options).toEqual({
      slotStartDate: "2026-08-03",
      slotDays: 45,
      includeFeedbackEntries: false,
      feedbackDays: 30,
      feedbackSearch: undefined,
    });
    expect(VenueDashboardQuerySchema.parse(scope.source.query)).toEqual(scope.options);
  });

  test("preserves the feedback scope and normalizes empty search", () => {
    const scope = venueDashboardRouteScope({
      venueId: "11111111-1111-4111-8111-111111111111",
      view: "feedback",
      calendarView: "week",
      calendarDate: "2026-08-10",
      feedbackDays: 14,
      feedbackSearch: "late shift",
    });

    expect(VenueDashboardQuerySchema.parse(scope.source.query)).toEqual(scope.options);
    expect(scope.options).toMatchObject({
      slotStartDate: "2026-08-10",
      slotDays: 14,
      includeFeedbackEntries: true,
      feedbackDays: 14,
      feedbackSearch: "late shift",
    });
  });

  test("compares every canonical source field", () => {
    const source = venueDashboardRouteScope({
      venueId: "11111111-1111-4111-8111-111111111111",
      view: "shifts",
      calendarView: "week",
      calendarDate: "2026-08-10",
      feedbackDays: 30,
      feedbackSearch: "",
    }).source;

    expect(sameVenueDashboardSource(source, { ...source, query: { ...source.query } })).toBe(true);
    expect(sameVenueDashboardSource(source, { ...source, query: { ...source.query, slotDays: "45" } })).toBe(false);
  });

  test("rejects unbounded browser query input", () => {
    expect(() => VenueDashboardQuerySchema.parse({ slotDays: "365" })).toThrow();
    expect(() => VenueDashboardQuerySchema.parse({ feedbackSearch: "x".repeat(201) })).toThrow();
  });
});
