import { describe, expect, test } from "bun:test";
import { buildNotebookExportFiles, createZip, exportFilename } from "./export";
import type { AttachmentContent } from "./attachments";
import type { Notebook } from "./notebooks";
import type { Note } from "./notes";

const notebook: Notebook = {
  id: "11111111-1111-4111-8111-111111111111",
  shortId: "nb1234",
  name: "Tech Docs",
  description: "Technical documentation",
  icon: "ti-book",
  homepageNoteId: null,
  homepageNoteShortId: null,
  scriptsEnabled: false,
  createdBy: "22222222-2222-4222-8222-222222222222",
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-02T00:00:00.000Z",
};

const notes: Note[] = [
  {
    id: "33333333-3333-4333-8333-333333333333",
    shortId: "noteA1",
    notebookId: notebook.id,
    parentId: null,
    title: "API Overview",
    position: 0,
    hasChildren: false,
    yjsSnapshotAt: null,
    contentMd: "See [Details](note://noteB2).\n\n![Diagram](attach://attA01)\n",
    createdBy: null,
    createdAt: "2026-05-03T00:00:00.000Z",
    updatedAt: "2026-05-04T00:00:00.000Z",
    lockedAt: null,
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    shortId: "noteB2",
    notebookId: notebook.id,
    parentId: null,
    title: "Details",
    position: 1,
    hasChildren: false,
    yjsSnapshotAt: null,
    contentMd: "# Details\n",
    createdBy: null,
    createdAt: "2026-05-03T00:00:00.000Z",
    updatedAt: "2026-05-04T00:00:00.000Z",
    lockedAt: null,
  },
];

const attachment: AttachmentContent = {
  id: "55555555-5555-4555-8555-555555555555",
  shortId: "attA01",
  notebookId: notebook.id,
  filename: "Architecture Diagram.png",
  mimeType: "image/png",
  sizeBytes: 3,
  kind: "image",
  createdBy: null,
  createdAt: "2026-05-05T00:00:00.000Z",
  content: new Uint8Array([1, 2, 3]),
};

describe("notebook export", () => {
  test("builds a readable portable file set", () => {
    const files = buildNotebookExportFiles({
      notebook,
      notes,
      attachments: [attachment],
      exportedAt: new Date("2026-05-28T00:00:00.000Z"),
    });

    expect(files.map((file) => file.path)).toEqual([
      "attachments.json",
      "attachments/attA01--Architecture-Diagram.png",
      "notebook.json",
      "notes/noteA1--api-overview.md",
      "notes/noteB2--details.md",
      "README.md",
      "tree.json",
    ]);

    const overview = files.find((file) => file.path === "notes/noteA1--api-overview.md")?.content;
    expect(overview).toContain('shortId: "noteA1"');
    expect(overview).toContain("[Details](./noteB2--details.md)");
    expect(overview).toContain("![Diagram](../attachments/attA01--Architecture-Diagram.png)");
  });

  test("creates a ZIP archive with local and central directory records", () => {
    const zip = createZip(
      [
        { path: "README.md", content: "hello\n" },
        { path: "notes/example.md", content: "# Example\n" },
      ],
      new Date("2026-05-28T00:00:00.000Z"),
    );

    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(zip.byteLength - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(zip.byteLength - 22 + 10, true)).toBe(2);
  });

  test("uses a safe date-stamped archive filename", () => {
    expect(exportFilename(notebook, new Date("2026-05-28T12:00:00.000Z"))).toBe("tech-docs-2026-05-28.zip");
  });
});
