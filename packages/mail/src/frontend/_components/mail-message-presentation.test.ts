import { describe, expect, test } from "bun:test";
import { attachmentPreviewSignatureMatches } from "../../attachment-preview-policy";
import {
  attachmentPreviewKind,
  normalizeContentId,
  referencedContentIds,
  rewriteCidSources,
  splitPlainMessageSegments,
} from "./mail-message-presentation";

describe("mail message presentation", () => {
  test("keeps plain content and quoted history in ordered segments", () => {
    expect(splitPlainMessageSegments("Answer\n\n> Older line\n>\n> Older detail\n\nClosing")).toEqual([
      { kind: "content", text: "Answer\n" },
      { kind: "quote", text: "> Older line\n>\n> Older detail" },
      { kind: "content", text: "\nClosing" },
    ]);
  });

  test("does not collapse ordinary attribution or indentation", () => {
    expect(splitPlainMessageSegments("On Monday, Alex wrote:\n  ordinary indented text")).toEqual([
      { kind: "content", text: "On Monday, Alex wrote:\n  ordinary indented text" },
    ]);
  });

  test("keeps blank lines within a quoted block", () => {
    expect(splitPlainMessageSegments("Reply\n> first\n\n\n> second\nAfter")).toEqual([
      { kind: "content", text: "Reply" },
      { kind: "quote", text: "> first\n\n\n> second" },
      { kind: "content", text: "After" },
    ]);
  });

  test("allows only bounded browser-safe attachment previews", () => {
    expect(attachmentPreviewKind("image/png", 1024)).toBe("image");
    expect(attachmentPreviewKind("image/svg+xml", 1024)).toBeNull();
    expect(attachmentPreviewKind("text/html", 1024)).toBeNull();
    expect(attachmentPreviewKind("application/pdf; name=report.pdf", 1024)).toBe("pdf");
    expect(attachmentPreviewKind("text/plain", 3 * 1024 * 1024)).toBeNull();
    expect(attachmentPreviewKind("video/mp4", 60 * 1024 * 1024)).toBeNull();
  });

  test("rejects declared binary preview types with mismatched signatures", () => {
    expect(attachmentPreviewSignatureMatches("application/pdf", new TextEncoder().encode("%PDF-1.7"))).toBeTrue();
    expect(attachmentPreviewSignatureMatches("application/pdf", new TextEncoder().encode("<html>"))).toBeFalse();
    expect(attachmentPreviewSignatureMatches("image/png", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeTrue();
    expect(attachmentPreviewSignatureMatches("image/png", new TextEncoder().encode("not-png"))).toBeFalse();
  });

  test("rewrites only known CID image sources to permission-checked object URLs", () => {
    const urls = new Map([["logo@example.com", "blob:https://cloud.example/cid-logo"]]);
    expect(normalizeContentId(" <Logo@Example.COM> ")).toBe("logo@example.com");
    expect(
      rewriteCidSources(
        '<img src="cid:Logo%40Example.COM"><img src="cid:unknown@example.com"><a href="cid:logo@example.com">link</a>',
        urls,
      ),
    ).toBe('<img src="blob:https://cloud.example/cid-logo"><img src="cid:unknown@example.com"><a href="cid:logo@example.com">link</a>');
  });

  test("extracts only normalized CIDs referenced by image sources", () => {
    expect(
      referencedContentIds('<img src="cid:Logo%40Example.COM"><img src="cid:logo@example.com"><a href="cid:ignored@example.com">link</a>'),
    ).toEqual(["logo@example.com"]);
  });
});
