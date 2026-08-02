import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { CapabilityExecutionContext, User } from "@valentinkolb/cloud/contracts";
import { audit } from "@valentinkolb/cloud/services";
import { compileCapabilities } from "../../cloud/src/_internal/capabilities";
import { decodeSpacesCapabilityCursor, spacesCapabilities } from "./capabilities";
import {
  CommentCreateInputSchema,
  EventCreateInputSchema,
  EventUpdateInputSchema,
  SpaceDetailDataSchema,
  SpaceListInputSchema,
  TaskCreateInputSchema,
  TaskUpdateInputSchema,
} from "./capability-contracts";
import type { SpaceComment, SpaceItem } from "./contracts";
import { spacesService } from "./service";

const userId = "11111111-1111-4111-8111-111111111111";
const serviceAccountId = "22222222-2222-4222-8222-222222222222";
const spaceId = "33333333-3333-4333-8333-333333333333";
const otherSpaceId = "44444444-4444-4444-8444-444444444444";
const columnId = "55555555-5555-4555-8555-555555555555";
const itemId = "66666666-6666-4666-8666-666666666666";
const commentId = "77777777-7777-4777-8777-777777777777";
const createdAt = "2026-08-02T08:00:00.000Z";

const user = {
  id: userId,
  uid: "spaces-user",
  roles: ["user"],
  provider: "local",
  profile: "user",
  givenname: "Spaces",
  sn: "User",
  displayName: "Spaces User",
  mail: "spaces@example.test",
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
      id: serviceAccountId,
      name: "Spaces resource account",
      kind: "resource_bound",
      status: "active",
      delegatedUserId: null,
      appId: "spaces",
      resourceType: "space",
      resourceId: spaceId,
      createdBy: null,
      createdAt,
    },
    delegatedUser: null,
    scopes: ["read"],
  },
  accessSubject: { type: "service_account", serviceAccountId },
  user: null,
  signal: new AbortController().signal,
} satisfies CapabilityExecutionContext;

const space = {
  id: spaceId,
  name: "Product",
  description: "Product planning",
  color: "#3b82f6",
  icalToken: "private-token",
  createdAt,
  updatedAt: createdAt,
};

const task: SpaceItem = {
  id: itemId,
  spaceId,
  columnId,
  title: "Ship capability",
  description: null,
  location: null,
  url: null,
  startsAt: null,
  endsAt: null,
  allDay: false,
  deadline: null,
  priority: "high",
  recurrence: null,
  recurringEventId: null,
  recurrenceId: null,
  rank: "1024",
  completedAt: null,
  createdBy: userId,
  createdAt,
  updatedAt: createdAt,
  assignees: [],
  tags: [],
};

const event: SpaceItem = {
  ...task,
  title: "Capability review",
  startsAt: "2026-08-02T10:00:00.000Z",
  endsAt: "2026-08-02T11:00:00.000Z",
  deadline: null,
};

const comment: SpaceComment = {
  id: commentId,
  itemId,
  recurrenceId: null,
  userId,
  userName: user.displayName,
  userAvatarHash: "presentation-only",
  content: "Ready for review",
  createdAt,
  updatedAt: createdAt,
  canDelete: true,
};

afterEach(() => mock.restore());

describe("spaces capabilities", () => {
  test("compiles calendar integration inputs into the registered manifest", () => {
    const compiled = compileCapabilities("spaces", spacesCapabilities);
    expect(compiled.manifest.queries.some((query) => query.localId === "calendar-invitation.preview")).toBeTrue();
    expect(compiled.manifest.actions.some((action) => action.localId === "calendar-invitation.import")).toBeTrue();
    expect(compiled.manifest.actions.some((action) => action.localId === "event.invitation.prepare")).toBeTrue();
  });

  test("lists only writable calendar destinations without accepting Mail ownership state", async () => {
    const list = spyOn(spacesService.space, "list").mockResolvedValue({
      items: [space],
      page: 1,
      perPage: 100,
      total: 1,
      hasNext: false,
    });

    const result = await spacesCapabilities.queries["calendar-destination.list"].run({}, userContext);

    expect(list).toHaveBeenCalledWith({
      subject: userContext.accessSubject,
      boundSpaceId: null,
      requiredLevel: "write",
      pagination: { page: 1, perPage: 100 },
    });
    expect(result).toEqual({ ok: true, data: { data: [{ id: spaceId, name: space.name, color: space.color }] } });
  });

  test("declares the complete bounded v1 surface and safety metadata", () => {
    expect(Object.keys(spacesCapabilities.types).sort()).toEqual(["comment", "item", "space"]);
    expect(Object.keys(spacesCapabilities.queries).sort()).toEqual([
      "calendar-destination.list",
      "calendar-invitation.preview",
      "calendar-invitation.response.prepare",
      "comment.get",
      "comment.list",
      "event.list",
      "item.get",
      "search",
      "space.get",
      "space.list",
      "task.list",
    ]);
    expect(Object.keys(spacesCapabilities.actions).sort()).toEqual([
      "calendar-invitation.import",
      "calendar-invitation.response.commit",
      "comment.create",
      "comment.delete",
      "comment.update",
      "event.create",
      "event.invitation.commit",
      "event.invitation.prepare",
      "event.update",
      "item.delete",
      "task.create",
      "task.set-completed",
      "task.update",
    ]);
    expect(
      Object.entries(spacesCapabilities.actions)
        .filter(([, action]) => "review" in action && action.review)
        .map(([id]) => id)
        .sort(),
    ).toEqual([
      "calendar-invitation.import",
      "calendar-invitation.response.commit",
      "comment.delete",
      "comment.update",
      "event.invitation.commit",
      "event.update",
      "item.delete",
      "task.set-completed",
      "task.update",
    ]);
    expect(spacesCapabilities.actions["task.create"]).toMatchObject({
      destructive: false,
      openWorld: false,
      approval: "once",
      idempotency: "none",
      target: { type: "space", inputField: "spaceId" },
    });
    expect(spacesCapabilities.actions["comment.delete"]).toMatchObject({
      destructive: true,
      openWorld: false,
      approval: "always",
      idempotency: "none",
      target: { type: "comment", inputField: "commentId" },
    });
  });

  test("prepares a draft invitation only after current event write access is rechecked", async () => {
    spyOn(spacesService.item, "get").mockResolvedValue(event);
    spyOn(spacesService.space, "get").mockResolvedValue(space);
    spyOn(spacesService.space.permission, "get").mockResolvedValue("write");
    const prepare = spyOn(spacesService.calendarInvitations, "prepareEventInvitationAttachment").mockResolvedValue({
      ok: true,
      data: {
        deliveryId: "88888888-8888-4888-8888-888888888888",
        itemId,
        mailboxId: "99999999-9999-4999-8999-999999999999",
        draftId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        sequence: 0,
        filename: "invitation.ics",
        contentType: "text/calendar; method=REQUEST; charset=utf-8",
        calendar: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
      },
    });
    spyOn(audit, "recordResultAfterSideEffect").mockImplementation(async ({ result }) => result);
    const context = { ...userContext, idempotencyKey: "mail-calendar-test" } satisfies CapabilityExecutionContext;

    const result = await spacesCapabilities.actions["event.invitation.prepare"].run(
      {
        itemId,
        mailboxId: "99999999-9999-4999-8999-999999999999",
        draftId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        senderIdentityId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        organizer: { name: "Organizer", address: "organizer@example.test" },
        attendees: [{ name: null, address: "attendee@example.test" }],
      },
      context,
    );

    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId,
        itemId,
        subject: userContext.accessSubject,
        deliveryId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      data: {
        refs: [
          { type: "spaces.item", id: itemId },
          { type: "mail.draft", id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
        ],
      },
    });
  });

  test("keeps task, event, comment, and output schemas strict", () => {
    expect(TaskCreateInputSchema.safeParse({ spaceId, columnId, title: "Task", startsAt: "2026-08-02T10:00:00.000Z" }).success).toBeFalse();
    expect(TaskUpdateInputSchema.safeParse({ itemId }).success).toBeFalse();
    expect(TaskUpdateInputSchema.safeParse({ itemId, columnId }).success).toBeFalse();
    expect(
      EventCreateInputSchema.safeParse({
        spaceId,
        columnId,
        title: "Event",
        startsAt: "2026-08-02T11:00:00.000Z",
        endsAt: "2026-08-02T10:00:00.000Z",
      }).success,
    ).toBeFalse();
    expect(EventUpdateInputSchema.safeParse({ itemId, startsAt: "2026-08-02T10:00:00.000Z" }).success).toBeFalse();
    expect(CommentCreateInputSchema.safeParse({ itemId, content: "x".repeat(5001) }).success).toBeFalse();
    expect(
      SpaceDetailDataSchema.safeParse({
        ...space,
        permission: "write",
        columns: [],
        tags: [],
      }).success,
    ).toBeFalse();
  });

  test("accepts only opaque v1 page cursors", () => {
    const cursor = Buffer.from(JSON.stringify({ v: 1, page: 3 }), "utf8").toString("base64url");
    expect(decodeSpacesCapabilityCursor(cursor)).toEqual({ ok: true, data: 3 });
    expect(decodeSpacesCapabilityCursor("not-a-cursor").ok).toBeFalse();
  });

  test("uses SQL-paginated space listing with the actor binding", async () => {
    const list = spyOn(spacesService.space, "listWithPermission").mockResolvedValue({
      items: [{ ...space, permission: "read" }],
      page: 2,
      perPage: 1,
      total: 3,
      hasNext: true,
    });
    const input = SpaceListInputSchema.parse({ limit: 1, cursor: encodePage(2) });

    const result = await spacesCapabilities.queries["space.list"].run(input, serviceAccountContext);

    expect(list).toHaveBeenCalledWith({
      subject: serviceAccountContext.accessSubject,
      boundSpaceId: spaceId,
      requiredLevel: "read",
      query: undefined,
      pagination: { page: 2, perPage: 1 },
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        data: [{ id: spaceId, permission: "read" }],
        refs: [{ type: "spaces.space", id: spaceId }],
        page: { hasMore: true },
      },
    });
  });

  test("fails a resource-bound credential closed before reading another Space", async () => {
    const get = spyOn(spacesService.space, "get");

    const result = await spacesCapabilities.queries["space.get"].run({ spaceId: otherSpaceId }, serviceAccountContext);

    expect(get).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: { code: "NOT_FOUND", message: "Space not found", status: 404 } });
  });

  test("rejects task-event cross-kind updates before mutation and audits the denial", async () => {
    spyOn(spacesService.item, "get").mockResolvedValue(event);
    spyOn(spacesService.space, "get").mockResolvedValue(space);
    spyOn(spacesService.space.permission, "get").mockResolvedValue("write");
    const update = spyOn(spacesService.item, "update");
    const recordDenied = spyOn(audit, "recordResult").mockImplementation(async ({ result }) => result);

    const result = await spacesCapabilities.actions["task.update"].run({ itemId, title: "Wrong kind" }, userContext);

    expect(update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, error: { code: "BAD_INPUT" } });
    expect(recordDenied).toHaveBeenCalledWith(expect.objectContaining({ action: "spaces.capability.task.update" }));
  });

  test("creates a task through the existing service and audits the side effect", async () => {
    spyOn(spacesService.space, "get").mockResolvedValue(space);
    spyOn(spacesService.space.permission, "get").mockResolvedValue("write");
    const create = spyOn(spacesService.item, "create").mockResolvedValue({ ok: true, data: task });
    const recordAllowed = spyOn(audit, "recordResultAfterSideEffect").mockImplementation(async ({ result }) => result);

    const result = await spacesCapabilities.actions["task.create"].run(
      { spaceId, columnId, title: task.title, priority: "high" },
      userContext,
    );

    expect(create).toHaveBeenCalledWith({
      spaceId,
      data: { columnId, title: task.title, priority: "high" },
      createdBy: userId,
    });
    expect(result).toMatchObject({
      ok: true,
      data: { data: { kind: "task", id: itemId }, refs: [{ type: "spaces.item", id: itemId }] },
    });
    expect(recordAllowed).toHaveBeenCalledWith(expect.objectContaining({ action: "spaces.capability.task.create" }));
  });

  test("reads comments through parent Space access without exposing avatar hashes", async () => {
    spyOn(spacesService.comment, "get").mockResolvedValue({ ...comment, canDelete: false });
    spyOn(spacesService.item, "get").mockResolvedValue(task);
    spyOn(spacesService.space, "get").mockResolvedValue(space);
    spyOn(spacesService.space.permission, "get").mockResolvedValue("read");

    const result = await spacesCapabilities.queries["comment.get"].run({ commentId }, serviceAccountContext);

    expect(result).toMatchObject({
      ok: true,
      data: {
        data: { id: commentId, itemId, content: comment.content, canDelete: false },
        refs: [
          { type: "spaces.comment", id: commentId },
          { type: "spaces.item", id: itemId },
        ],
      },
    });
    expect(result.ok && "userAvatarHash" in result.data.data).toBeFalse();
  });

  test("keeps comment writes user-backed and propagates the existing delete window", async () => {
    const recordDenied = spyOn(audit, "recordResult").mockImplementation(async ({ result }) => result);
    const create = spyOn(spacesService.comment, "create");

    const denied = await spacesCapabilities.actions["comment.create"].run({ itemId, content: "No author" }, serviceAccountContext);

    expect(create).not.toHaveBeenCalled();
    expect(denied).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });

    spyOn(spacesService.comment, "get").mockResolvedValue(comment);
    spyOn(spacesService.item, "get").mockResolvedValue(task);
    spyOn(spacesService.space, "get").mockResolvedValue(space);
    spyOn(spacesService.space.permission, "get").mockResolvedValue("write");
    spyOn(spacesService.comment, "remove").mockResolvedValue({
      ok: false,
      error: "Comments can only be deleted within 10 minutes",
      status: 403,
    });

    const expired = await spacesCapabilities.actions["comment.delete"].run({ commentId }, userContext);

    expect(expired).toMatchObject({ ok: false, error: { code: "FORBIDDEN", status: 403 } });
    expect(recordDenied).toHaveBeenCalledTimes(2);
  });
});

const encodePage = (page: number) => Buffer.from(JSON.stringify({ v: 1, page }), "utf8").toString("base64url");
