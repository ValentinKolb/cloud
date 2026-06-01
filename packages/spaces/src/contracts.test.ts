import { describe, expect, test } from "bun:test";
import { CalendarQuerySchema, CreateItemSchema, OverlapQuerySchema, UpdateItemSchema } from "./contracts";

const START = "2026-06-01T09:00:00.000Z";
const END = "2026-06-01T10:00:00.000Z";
const BEFORE_START = "2026-06-01T08:00:00.000Z";

describe("Spaces contract time ranges", () => {
  test("accepts valid create, update, calendar, and overlap ranges", () => {
    expect(CreateItemSchema.safeParse({ columnId: crypto.randomUUID(), title: "Event", startsAt: START, endsAt: END }).success).toBe(true);
    expect(UpdateItemSchema.safeParse({ startsAt: START, endsAt: END }).success).toBe(true);
    expect(CalendarQuerySchema.safeParse({ from: START, to: END }).success).toBe(true);
    expect(OverlapQuerySchema.safeParse({ from: START, to: END }).success).toBe(true);
  });

  test("rejects ranges whose end is not after the start", () => {
    expect(
      CreateItemSchema.safeParse({ columnId: crypto.randomUUID(), title: "Event", startsAt: START, endsAt: BEFORE_START }).success,
    ).toBe(false);
    expect(UpdateItemSchema.safeParse({ startsAt: START, endsAt: BEFORE_START }).success).toBe(false);
    expect(CalendarQuerySchema.safeParse({ from: START, to: BEFORE_START }).success).toBe(false);
    expect(OverlapQuerySchema.safeParse({ from: START, to: BEFORE_START }).success).toBe(false);
  });
});
