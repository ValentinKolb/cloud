import { describe, expect, test } from "bun:test";
import type { TableQueryResult, RecordQuery } from "../../../contracts";
import {
  highlightedIdsForLiveRefresh,
  isLiveRecordEventForTable,
  isTerminalLiveErrorCode,
  liveRefreshQuery,
  shouldLoadNextLiveRefreshPage,
  shouldOptimisticallyRemoveDeletedRecord,
  visibleIdsFromResult,
} from "./live-refresh";

describe("records live refresh helpers", () => {
  test("accepts only v1 record events for the active table", () => {
    const event = {
      v: 1,
      type: "record.updated",
      baseId: "base-1",
      tableId: "table-1",
      recordId: "record-1",
      version: 2,
      changedFieldIds: [],
      actorId: null,
      occurredAt: "2026-05-29T00:00:00.000Z",
    };

    expect(isLiveRecordEventForTable(event, "table-1")).toBe(true);
    expect(isLiveRecordEventForTable({ ...event, type: "record.restored" }, "table-1")).toBe(true);
    expect(isLiveRecordEventForTable(event, "table-2")).toBe(false);
    expect(isLiveRecordEventForTable({ ...event, type: "automation.run" }, "table-1")).toBe(false);
    expect(isLiveRecordEventForTable({ ...event, v: 2 }, "table-1")).toBe(false);
  });

  test("highlights changed visible rows and newly visible rows", () => {
    expect(
      highlightedIdsForLiveRefresh({
        eventRecordIds: ["b", "x"],
        previousVisibleIds: ["a", "b"],
        nextVisibleIds: ["b", "c"],
      }).sort(),
    ).toEqual(["b", "c"]);
  });

  test("keeps each live refetch page bounded while covering visible rows", () => {
    const query = { filter: undefined } as RecordQuery;
    expect(liveRefreshQuery(query, 140).limit).toBe(140);
    expect(liveRefreshQuery({ ...query, limit: 20 }, 5).limit).toBe(20);
    expect(liveRefreshQuery({ ...query, limit: 1000 }, 700).limit).toBe(500);
  });

  test("continues live refetch pagination only while the visible slice is incomplete", () => {
    expect(shouldLoadNextLiveRefreshPage({ loadedCount: 500, targetCount: 700, nextCursor: "next" })).toBe(true);
    expect(shouldLoadNextLiveRefreshPage({ loadedCount: 700, targetCount: 700, nextCursor: "next" })).toBe(false);
    expect(shouldLoadNextLiveRefreshPage({ loadedCount: 500, targetCount: 700, nextCursor: null })).toBe(false);
  });

  test("extracts visible record ids from query results", () => {
    const result = {
      items: [
        { id: "a", tableId: "t", data: {}, version: 1 },
        { id: "b", tableId: "t", data: {}, version: 1 },
      ],
      nextCursor: null,
    } as TableQueryResult;
    expect(visibleIdsFromResult(result)).toEqual(["a", "b"]);
  });

  test("treats only permanent live errors as terminal", () => {
    expect(isTerminalLiveErrorCode("login_required")).toBe(true);
    expect(isTerminalLiveErrorCode("access_denied")).toBe(true);
    expect(isTerminalLiveErrorCode("not_found")).toBe(true);
    expect(isTerminalLiveErrorCode("stream_failed")).toBe(false);
    expect(isTerminalLiveErrorCode("invalid_message")).toBe(false);
    expect(isTerminalLiveErrorCode("backpressure")).toBe(false);
    expect(isTerminalLiveErrorCode(undefined)).toBe(false);
  });

  test("optimistically removes deletes only from live-only queries", () => {
    expect(shouldOptimisticallyRemoveDeletedRecord({})).toBe(true);
    expect(shouldOptimisticallyRemoveDeletedRecord({ includeDeleted: true })).toBe(false);
    expect(shouldOptimisticallyRemoveDeletedRecord({ deletedOnly: true })).toBe(false);
  });
});
