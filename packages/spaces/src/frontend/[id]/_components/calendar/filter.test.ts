import { describe, expect, test } from "bun:test";
import { defaultCalendarFilter, parseCalendarFilter, writeCalendarFilter } from "./filter";

describe("calendar URL filters", () => {
  test("uses defaults for absent or malformed values", () => {
    expect(parseCalendarFilter(new URL("https://cloud.test/app/spaces/1?ctype=nope&cpriority=urgent,nope"))).toEqual(defaultCalendarFilter);
  });

  test("round-trips supported filters without unrelated query changes", () => {
    const url = new URL("https://cloud.test/app/spaces/1?view=calendar&item=abc&ctags=stale");
    const filter = {
      type: "event" as const,
      assignedTo: "me" as const,
      priorities: ["urgent", "high"] as Array<"urgent" | "high">,
      columnIds: ["todo"],
      tagIds: ["ops"],
    };

    writeCalendarFilter(url, filter);

    expect(parseCalendarFilter(url)).toEqual(filter);
    expect(url.searchParams.get("view")).toBe("calendar");
    expect(url.searchParams.get("item")).toBe("abc");
  });

  test("removes default values from generated URLs", () => {
    const url = new URL("https://cloud.test/app/spaces/1?ctype=event&cassigned=me&cpriority=high&ccolumns=todo&ctags=ops");
    writeCalendarFilter(url, defaultCalendarFilter);
    expect(url.search).toBe("");
  });
});
