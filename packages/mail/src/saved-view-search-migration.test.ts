import { describe, expect, test } from "bun:test";
import { mailSearchStateSchema } from "./contracts";
import { canonicalizeSavedViewFilter, migrateLegacySavedViewFilter } from "./saved-view-search-migration";

describe("saved view search migration", () => {
  test("preserves every legacy filter dimension in the canonical search AST", () => {
    const folderId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const migrated = migrateLegacySavedViewFilter({
      folderId,
      workStatuses: ["open", "waiting"],
      assignee: { kind: "user", userId },
      responseNeeded: true,
      snoozed: false,
      watchedByMe: true,
    });

    expect(mailSearchStateSchema.parse(migrated)).toEqual({
      expression: {
        type: "and",
        expressions: [
          { type: "folder_id", folderId },
          {
            type: "or",
            expressions: [
              { type: "work_status", value: "open" },
              { type: "work_status", value: "waiting" },
            ],
          },
          { type: "assignee", userId },
          { type: "response_needed", value: true },
          { type: "snoozed", value: false },
          { type: "watched_by_me", value: true },
        ],
      },
      sort: "newest",
    });
  });

  test("keeps dynamic current-user filters and maps an empty view to all conversations", () => {
    expect(migrateLegacySavedViewFilter({ assignee: { kind: "me" } })).toEqual({
      expression: { type: "assigned_to_me" },
      sort: "newest",
    });
    expect(migrateLegacySavedViewFilter({})).toEqual({
      expression: { type: "all" },
      sort: "newest",
    });
  });

  test("keeps canonical views and safely recovers malformed alpha views", () => {
    const canonical = {
      expression: { type: "text" as const, field: "subject" as const, query: "invoice", match: "words" as const },
      sort: "relevance" as const,
    };
    expect(canonicalizeSavedViewFilter(canonical)).toEqual({ state: canonical, changed: false, recovered: false });
    expect(canonicalizeSavedViewFilter({ unsupported: true })).toEqual({
      state: { expression: { type: "all" }, sort: "newest" },
      changed: true,
      recovered: true,
    });
    expect(canonicalizeSavedViewFilter("not-json")).toEqual({
      state: { expression: { type: "all" }, sort: "newest" },
      changed: true,
      recovered: true,
    });
  });
});
