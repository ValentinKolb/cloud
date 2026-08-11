import { beforeEach, describe, expect, test } from "bun:test";
import { createKitAttachmentsAPI } from "./kit-attachments";
import { createKitNotesAPI } from "./kit-notes";
import type { KitContext } from "./kit-types";

const notesResponse = {
  data: [
    {
      id: "note01",
      notebookId: "book01",
      parentId: "root01",
      title: "Child",
      contentMd: "# Child",
      createdAt: "2026-08-11T08:00:00.000Z",
      updatedAt: "2026-08-11T09:00:00.000Z",
      lockedAt: null,
    },
  ],
  pagination: { page: 1, per_page: 100, total: 1, total_pages: 1, has_next: false },
};

const attachmentsResponse = [
  {
    id: "file01",
    notebookId: "book01",
    filename: "guide.pdf",
    mimeType: "application/pdf",
    sizeBytes: 42,
    kind: "file",
    createdAt: "2026-08-11T08:00:00.000Z",
  },
];

beforeEach(() => {
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return Response.json(url.includes("/attachments") ? attachmentsResponse : notesResponse);
    },
    { preconnect: () => {} },
  ) as typeof fetch;
});

const context = (): KitContext => ({
  mode: "read",
  notebookId: "book01",
  note: {
    id: "note00",
    title: "Current",
    content: "",
    notebookName: "Knowledge",
    parentId: null,
    createdAt: "2026-08-11T08:00:00.000Z",
    updatedAt: "2026-08-11T09:00:00.000Z",
    lockedAt: null,
  },
  outputEl: {} as HTMLElement,
});

describe("notebook script API public resource IDs", () => {
  test("keeps note and parent short IDs unchanged from the wire", async () => {
    const notes = await createKitNotesAPI(context()).list();

    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ id: "note01", parentId: "root01" });
    expect(notes[0]).not.toHaveProperty("shortId");
  });

  test("keeps attachment short IDs unchanged from the wire", async () => {
    const attachments = await createKitAttachmentsAPI(context()).list();

    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({ id: "file01", filename: "guide.pdf" });
    expect(attachments[0]).not.toHaveProperty("shortId");
  });
});
