import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { CapabilityExecutionContext, User } from "@valentinkolb/cloud/contracts";
import { audit } from "@valentinkolb/cloud/services";
import { decodeNotebookCapabilityCursor, decodeNotebookTreeCursor, notebooksCapabilities } from "./capabilities";
import { NoteCreateInputSchema, NoteDetailDataSchema, NoteEditInputSchema, NoteTreeDataSchema } from "./capability-contracts";
import { noteContentHash } from "./lib/note-edit";
import * as notebookStore from "./service/notebooks";
import * as noteStore from "./service/notes";

const userId = "11111111-1111-4111-8111-111111111111";
const serviceAccountId = "22222222-2222-4222-8222-222222222222";
const notebookId = "33333333-3333-4333-8333-333333333333";
const otherNotebookId = "44444444-4444-4444-8444-444444444444";
const noteId = "55555555-5555-4555-8555-555555555555";
const createdAt = "2026-08-02T08:00:00.000Z";
const activeSpies: Array<{ mockRestore(): void }> = [];

const trackedSpy = <T extends { mockRestore(): void }>(spy: T): T => {
  activeSpies.push(spy);
  return spy;
};

const user = {
  id: userId,
  uid: "notebooks-user",
  roles: ["user"],
  provider: "local",
  profile: "user",
  givenname: "Notebook",
  sn: "User",
  displayName: "Notebook User",
  mail: "notebooks@example.test",
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

const resourceContext = (scopes: string[]) =>
  ({
    actor: {
      kind: "service_account",
      serviceAccount: {
        id: serviceAccountId,
        name: "Notebook resource account",
        kind: "resource_bound",
        status: "active",
        delegatedUserId: null,
        appId: "notebooks",
        resourceType: "notebook",
        resourceId: notebookId,
        createdBy: null,
        createdAt,
      },
      delegatedUser: null,
      scopes,
    },
    accessSubject: { type: "service_account", serviceAccountId },
    user: null,
    signal: new AbortController().signal,
  }) satisfies CapabilityExecutionContext;

const notebook = {
  id: notebookId,
  shortId: "abc123",
  name: "Knowledge",
  description: "Team knowledge",
  icon: null,
  homepageNoteId: noteId,
  homepageNoteShortId: "def456",
  scriptsEnabled: false,
  defaultNoteTitleTemplate: "Untitled",
  createdBy: userId,
  createdAt,
  updatedAt: createdAt,
};

const note = {
  id: noteId,
  shortId: "def456",
  notebookId,
  parentId: null,
  title: "Knowledge index",
  position: 0,
  hasChildren: false,
  yjsSnapshotAt: createdAt,
  contentMd: '# Knowledge index\n\n#docs\n\n@facts\n:::data\n{"ready":true}\n:::',
  createdBy: userId,
  createdAt,
  updatedAt: createdAt,
  lockedAt: null,
};

afterEach(() => {
  for (const spy of activeSpies.splice(0)) spy.mockRestore();
});

describe("notebooks capabilities", () => {
  test("declares the complete bounded wiki surface", () => {
    expect(Object.keys(notebooksCapabilities.types).sort()).toEqual(["note", "notebook"]);
    expect(Object.keys(notebooksCapabilities.queries).sort()).toEqual([
      "note.get",
      "note.links",
      "note.search",
      "note.tree",
      "notebook.get",
      "notebook.list",
      "notebook.search",
      "tag.list",
      "tag.notes",
    ]);
    expect(Object.keys(notebooksCapabilities.actions).sort()).toEqual(["note.create", "note.edit", "note.move"]);
    expect(notebooksCapabilities.actions["note.edit"]).toMatchObject({
      destructive: false,
      openWorld: false,
      approval: "once",
      idempotency: "none",
      target: { type: "note", inputField: "noteId" },
    });
    expect(
      Object.entries(notebooksCapabilities.queries)
        .filter(([, query]) => "universalSearch" in query && query.universalSearch)
        .map(([id]) => id)
        .sort(),
    ).toEqual(["note.search", "notebook.search"]);
  });

  test("keeps write schemas strict and bounded", () => {
    expect(NoteCreateInputSchema.safeParse({ notebookId, content: "# Note", unexpected: true }).success).toBeFalse();
    expect(NoteEditInputSchema.safeParse({ noteId, operations: [] }).success).toBeFalse();
    expect(
      NoteEditInputSchema.safeParse({
        noteId,
        operations: [{ kind: "append", content: "x" }],
        ifContentHash: "not-a-hash",
      }).success,
    ).toBeFalse();
    expect(
      NoteTreeDataSchema.safeParse([
        { id: noteId, shortId: "def456", parentId: null, title: "Note", position: 0, hasChildren: false, content: "hidden" },
      ]).success,
    ).toBeFalse();
  });

  test("accepts only opaque page and stable tree cursors", () => {
    const pageCursor = Buffer.from(JSON.stringify({ v: 1, page: 4 }), "utf8").toString("base64url");
    const treeCursor = Buffer.from(JSON.stringify({ v: 1, afterId: noteId }), "utf8").toString("base64url");
    expect(decodeNotebookCapabilityCursor(pageCursor)).toEqual({ ok: true, data: 4 });
    expect(decodeNotebookTreeCursor(treeCursor)).toEqual({ ok: true, data: noteId });
    expect(decodeNotebookCapabilityCursor("broken").ok).toBeFalse();
    expect(decodeNotebookTreeCursor(pageCursor).ok).toBeFalse();
  });

  test("reads bounded Markdown without exposing Yjs state", async () => {
    trackedSpy(spyOn(noteStore, "get")).mockResolvedValue(note);
    trackedSpy(spyOn(notebookStore, "get")).mockResolvedValue(notebook);
    trackedSpy(spyOn(notebookStore, "getPermission")).mockResolvedValue("read");
    trackedSpy(spyOn(noteStore, "getWithContent")).mockResolvedValue({
      ...note,
      yjsSnapshot: "private-snapshot",
    });

    const result = await notebooksCapabilities.queries["note.get"].run({ noteId, contentOffset: 0, contentLimit: 12 }, userContext);
    expect(result.ok).toBeTrue();
    if (!result.ok) return;
    expect(result.data.data.content).toBe("# Knowledge ");
    expect(result.data.data.contentComplete).toBeFalse();
    expect(result.data.data.nextContentOffset).toBe(12);
    expect(result.data.data.contentHash).toBe(noteContentHash(note.contentMd));
    expect(result.data.data.tags).toEqual(["docs"]);
    expect(result.data.data).not.toHaveProperty("yjsSnapshot");
    expect(NoteDetailDataSchema.safeParse(result.data.data).success).toBeTrue();
  });

  test("confines resource accounts and caps writes by scope", async () => {
    const getNotebook = trackedSpy(spyOn(notebookStore, "get")).mockResolvedValue(notebook);
    const outside = await notebooksCapabilities.queries["notebook.get"].run({ notebookId: otherNotebookId }, resourceContext(["read"]));
    expect(outside.ok).toBeFalse();
    expect(getNotebook).not.toHaveBeenCalled();

    trackedSpy(spyOn(noteStore, "get")).mockResolvedValue(note);
    trackedSpy(spyOn(notebookStore, "getPermission")).mockResolvedValue("admin");
    const editContent = trackedSpy(spyOn(noteStore, "editContent"));
    const edit = await notebooksCapabilities.actions["note.edit"].run(
      { noteId, operations: [{ kind: "append", content: "Update" }] },
      resourceContext(["read"]),
    );
    expect(edit.ok).toBeFalse();
    expect(editContent).not.toHaveBeenCalled();
  });

  test("routes edits through the conflict-aware service and audits success", async () => {
    trackedSpy(spyOn(noteStore, "get")).mockResolvedValue(note);
    trackedSpy(spyOn(notebookStore, "get")).mockResolvedValue(notebook);
    trackedSpy(spyOn(notebookStore, "getPermission")).mockResolvedValue("write");
    const afterHash = noteContentHash(`${note.contentMd}\nUpdate`);
    const editContent = trackedSpy(spyOn(noteStore, "editContent")).mockResolvedValue({
      ok: true,
      data: {
        note: { ...note, updatedAt: "2026-08-02T09:00:00.000Z" },
        content: `${note.contentMd}\nUpdate`,
        changed: true,
        beforeHash: noteContentHash(note.contentMd),
        afterHash,
        blocks: [],
      },
    });
    const record = trackedSpy(spyOn(audit, "recordResultAfterSideEffect")).mockImplementation(async ({ result }) => result);

    const result = await notebooksCapabilities.actions["note.edit"].run(
      { noteId, operations: [{ kind: "append", content: "Update" }], ifContentHash: noteContentHash(note.contentMd) },
      userContext,
    );
    expect(result.ok).toBeTrue();
    expect(editContent).toHaveBeenCalledWith({
      noteId,
      data: {
        operations: [{ kind: "append", content: "Update" }],
        ifContentHash: noteContentHash(note.contentMd),
      },
      createdBy: userId,
    });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: "notebooks.capability.note.edit" }));
  });
});
