import { describe, expect, test } from "bun:test";
import {
  CalendarQuerySchema,
  CreateItemSchema,
  CreateSpaceSchema,
  ItemFilterSchema,
  OverlapQuerySchema,
  UpdateItemSchema,
} from "./contracts";

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

describe("Spaces starter contracts", () => {
  test("keeps starter selection optional and accepts the supported workflows", () => {
    expect(CreateSpaceSchema.safeParse({ name: "Legacy client" }).success).toBe(true);
    for (const starter of ["blank", "tasks", "calendar", "project"]) {
      expect(CreateSpaceSchema.safeParse({ name: "Team space", starter }).success).toBe(true);
    }
  });

  test("rejects unknown starter identifiers", () => {
    expect(CreateSpaceSchema.safeParse({ name: "Team space", starter: "crm" }).success).toBe(false);
  });
});

test("Spaces item filters default the overview to schedule grouping", () => {
  expect(ItemFilterSchema.parse({}).groupBy).toBe("deadline");
});
