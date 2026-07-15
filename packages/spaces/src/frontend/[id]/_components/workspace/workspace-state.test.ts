import { beforeEach, describe, expect, mock, test } from "bun:test";

const SPACE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const COLUMN_ID = "33333333-3333-4333-8333-333333333333";
const ITEM_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_SPACE_ID = "66666666-6666-4666-8666-666666666666";
const calls: string[] = [];
let permission = "read";
let itemSpaceId = SPACE_ID;

const space = {
  id: SPACE_ID,
  name: "Delivery",
  description: null,
  color: "#3b82f6",
  icalToken: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const column = { id: COLUMN_ID, spaceId: SPACE_ID, name: "To Do", color: null, rank: "1024", isDone: false };
const item = {
  id: ITEM_ID,
  spaceId: SPACE_ID,
  columnId: COLUMN_ID,
  title: "Ship SSR",
  description: null,
  location: null,
  url: null,
  startsAt: null,
  endsAt: null,
  allDay: false,
  deadline: null,
  priority: null,
  recurrence: null,
  recurringEventId: null,
  recurrenceId: null,
  rank: "1024",
  completedAt: null,
  createdBy: USER_ID,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const comment = {
  id: "55555555-5555-4555-8555-555555555555",
  itemId: ITEM_ID,
  userId: USER_ID,
  userName: "Ada",
  userAvatarHash: null,
  content: "Ready",
  createdAt: "2026-01-01T01:00:00.000Z",
  updatedAt: "2026-01-01T01:00:00.000Z",
  canDelete: true,
};

mock.module("@valentinkolb/cloud/services", () => ({
  logger: () => ({ warn: () => undefined }),
  weatherService: {
    location: { cookie: { name: "weather", parse: () => null } },
    forecast: { get: async () => null },
    ui: { getTablerIcon: () => "ti ti-cloud" },
  },
}));

mock.module("@/service/events", () => ({
  latestSpaceEventCursor: async () => {
    calls.push("cursor");
    return "7-1";
  },
}));

mock.module("@/service", () => ({
  spacesService: {
    space: {
      get: async () => {
        calls.push("space.get");
        return space;
      },
      getDetail: async () => {
        calls.push("space.getDetail");
        return { ...space, columns: [column], tags: [] };
      },
      permission: { get: async () => permission },
    },
    item: {
      listFiltered: async () => ({ items: [item], total: 1, page: 1, pageSize: 50, totalPages: 1 }),
      get: async () => {
        calls.push("item.get");
        return { ...item, spaceId: itemSpaceId };
      },
      calendar: { list: async () => [] },
    },
    comment: {
      list: async () => {
        calls.push("comment.list");
        return { items: [comment], page: 1, perPage: 50, total: 1, hasNext: false };
      },
    },
    access: {
      list: async () => ({ items: [], page: 1, perPage: 0, total: 0, hasNext: false }),
      apiKeys: { list: async () => [] },
    },
    wormhole: {
      actorForUser: () => ({}),
      listUsable: async () => [],
      listConfigured: async () => ({ ok: true, data: [] }),
    },
  },
}));

const { loadSpaceItemDetail, loadSpacesViewSnapshot, loadSpacesWorkspaceState } = await import("./workspace-state");

beforeEach(() => {
  calls.splice(0);
  permission = "read";
  itemSpaceId = SPACE_ID;
});

describe("Spaces workspace SSR state", () => {
  test("captures the live cursor after authorization and before snapshot queries", async () => {
    const state = await loadSpacesWorkspaceState({
      user: { id: USER_ID, roles: ["user"] },
      spaceId: SPACE_ID,
      href: `/app/spaces/${SPACE_ID}`,
    });

    expect(state.kind).toBe("ok");
    expect(calls.indexOf("space.get")).toBeLessThan(calls.indexOf("cursor"));
    expect(calls.indexOf("cursor")).toBeLessThan(calls.indexOf("space.getDetail"));
    if (state.kind === "ok") expect(state.eventCursor).toBe("7-1");
  });

  test("includes the selected item and bounded comments page in a deep-link snapshot", async () => {
    const state = await loadSpacesWorkspaceState({
      user: { id: USER_ID, roles: ["user"] },
      spaceId: SPACE_ID,
      href: `/app/spaces/${SPACE_ID}?item=${ITEM_ID}`,
    });

    expect(state.kind).toBe("ok");
    if (state.kind !== "ok") return;
    expect(state.selectedItem?.id).toBe(ITEM_ID);
    expect(state.selectedItemComments).toEqual({ items: [comment], page: 1, perPage: 50, total: 1, hasNext: false });
  });

  test("refreshes a view without loading item comments", async () => {
    const snapshot = await loadSpacesViewSnapshot({
      user: { id: USER_ID, roles: ["user"] },
      spaceId: SPACE_ID,
      href: `/app/spaces/${SPACE_ID}?item=${ITEM_ID}`,
    });

    expect(snapshot.kind).toBe("list");
    expect(calls).not.toContain("comment.list");
  });

  test("fails closed before reading cursor or snapshot data", async () => {
    permission = "none";
    const state = await loadSpacesWorkspaceState({
      user: { id: USER_ID, roles: ["user"] },
      spaceId: SPACE_ID,
      href: `/app/spaces/${SPACE_ID}`,
    });

    expect(state.kind).toBe("accessDenied");
    expect(calls).not.toContain("cursor");
    expect(calls).not.toContain("space.getDetail");
  });

  test("detail loading rejects missing access and cross-space item ids before comments", async () => {
    permission = "none";
    const denied = await loadSpaceItemDetail({ user: { id: USER_ID, roles: ["user"] }, spaceId: SPACE_ID, itemId: ITEM_ID });
    expect(denied.kind).toBe("accessDenied");
    expect(calls).not.toContain("item.get");

    calls.splice(0);
    permission = "read";
    itemSpaceId = OTHER_SPACE_ID;
    const mismatched = await loadSpaceItemDetail({ user: { id: USER_ID, roles: ["user"] }, spaceId: SPACE_ID, itemId: ITEM_ID });
    expect(mismatched.kind).toBe("notFound");
    expect(calls).toContain("item.get");
    expect(calls).not.toContain("comment.list");
  });
});
