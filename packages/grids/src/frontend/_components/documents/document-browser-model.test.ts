import { describe, expect, test } from "bun:test";
import type { DocumentRunFolder, DocumentRunSummary } from "../../../contracts";
import {
  activeDocumentViewMode,
  appendDocumentBrowserPage,
  documentBrowserEmptyText,
  documentBrowserKey,
  documentCountLabel,
  documentRunActionState,
  replaceDocumentBrowserPage,
  serializeDocumentBrowserKey,
} from "./document-browser-model";

const run = (id: string): DocumentRunSummary => ({
  id,
  shortId: id,
  baseId: "base",
  tableId: "table",
  recordId: "record",
  filename: `${id}.pdf`,
  templateId: "template",
  workflowRunId: null,
  snapshotId: "snapshot",
  documentNumber: id,
  tags: [],
  generatedBy: null,
  generatedAt: "2026-01-01T00:00:00.000Z",
});
const folder = (label: string, count: number): DocumentRunFolder => ({ kind: "year", key: label, label, count, path: [label] });

describe("document browser model", () => {
  test("search always uses list mode and removes folder scope", () => {
    expect(activeDocumentViewMode("folders", "invoice")).toBe("list");
    expect(documentBrowserKey("template", "folders", "invoice", ["2026", "07"])).toEqual({
      templateId: "template",
      search: "invoice",
      mode: "list",
      path: [],
    });
  });

  test("folder mode keeps its current path without search", () => {
    const key = documentBrowserKey("template", "folders", "", ["2026", "07"]);
    expect(key.path).toEqual(["2026", "07"]);
    expect(serializeDocumentBrowserKey(key)).toBe("template:folders::2026/07");
  });

  test("pagination appends only to the browser request that started it", () => {
    const initial = replaceDocumentBrowserPage({ items: [run("one")], folders: [], total: 3, hasMore: true, nextCursor: "next" });
    const appended = appendDocumentBrowserPage(
      initial,
      { items: [run("two")], total: 3, hasMore: true, nextCursor: "last" },
      "same",
      "same",
    );
    expect(appended.runs.map((item) => item.id)).toEqual(["one", "two"]);
    expect(appended.nextCursor).toBe("last");

    const stale = appendDocumentBrowserPage(appended, { items: [run("stale")] }, "old", "new");
    expect(stale).toBe(appended);
  });

  test("count and empty labels match list, search, and folder states", () => {
    expect(documentCountLabel("list", [], [run("one")], 3)).toBe("1 of 3 documents");
    expect(documentCountLabel("folders", [folder("2026", 4), folder("2025", 2)], [], 0)).toBe("6 documents");
    expect(documentBrowserEmptyText("invoice", "list", [])).toBe("No documents match this search.");
    expect(documentBrowserEmptyText("", "folders", ["2026"])).toBe("This folder is empty.");
  });

  test("read users only get download actions and busy state is per run", () => {
    expect(documentRunActionState(false, "one", "one")).toEqual({ showEdit: false, showLink: false, downloadBusy: true });
    expect(documentRunActionState(true, "one", "two")).toEqual({ showEdit: true, showLink: true, downloadBusy: false });
  });
});
