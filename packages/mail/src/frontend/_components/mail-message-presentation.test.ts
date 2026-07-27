import { describe, expect, test } from "bun:test";
import { attachmentPreviewSignatureMatches } from "../../attachment-preview-policy";
import {
  attachmentPreviewKind,
  messageDeliveryControlLabel,
  messageDeliveryPresentation,
  messagePreviewText,
  normalizeContentId,
  referencedContentIds,
  referencedRemoteImageIds,
  rewriteCidSources,
  rewriteRemoteImageSources,
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
      {
        kind: "content",
        text: "On Monday, Alex wrote:\n  ordinary indented text",
      },
    ]);
  });

  test("keeps blank lines within a quoted block", () => {
    expect(splitPlainMessageSegments("Reply\n> first\n\n\n> second\nAfter")).toEqual([
      { kind: "content", text: "Reply" },
      { kind: "quote", text: "> first\n\n\n> second" },
      { kind: "content", text: "After" },
    ]);
  });

  test("builds a bounded one-line preview from new content rather than quoted history", () => {
    expect(messagePreviewText("Short answer\n\n> much older text", "")).toBe("Short answer");
    expect(messagePreviewText(null, "HTML fallback\nwith spacing")).toBe("HTML fallback with spacing");
    expect(messagePreviewText("123456789", "", 6)).toBe("12345…");
  });

  test("keeps normal sent delivery quiet and presents exceptional delivery states", () => {
    expect(messageDeliveryPresentation("accepted")).toBeNull();
    expect(messageDeliveryPresentation("sent_sync_pending")).toBeNull();
    expect(messageDeliveryPresentation("sent")).toBeNull();
    expect(messageDeliveryPresentation("reconciled_accepted")).toBeNull();
    expect(messageDeliveryPresentation("sending")).toMatchObject({ label: "Sending", tone: "running" });
    expect(messageDeliveryPresentation("failed")).toMatchObject({ label: "Send failed", tone: "error" });
  });

  test("offers cancellation only while a queued delivery remains controllable", () => {
    expect(messageDeliveryControlLabel("undo_window", true)).toBe("Undo send");
    expect(messageDeliveryControlLabel("scheduled", true)).toBe("Cancel send");
    expect(messageDeliveryControlLabel("sending", true)).toBeNull();
    expect(messageDeliveryControlLabel("undo_window", false)).toBeNull();
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

  test("rewrites only known opaque remote image references", () => {
    const first = "00000000-0000-4000-8000-000000000001";
    const second = "00000000-0000-4000-8000-000000000002";
    const html = `<img alt="known" data-mail-remote-image="${first}"><img data-mail-remote-image="${second}">`;
    expect(referencedRemoteImageIds(html)).toEqual([first, second]);
    expect(rewriteRemoteImageSources(html, new Map([[first, "blob:https://cloud.example/remote-image"]]))).toBe(
      `<img alt="known" src="blob:https://cloud.example/remote-image" data-mail-remote-image="${first}"><img data-mail-remote-image="${second}">`,
    );
  });
});
