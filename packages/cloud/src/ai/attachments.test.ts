import { describe, expect, test } from "bun:test";
import { aiAttachmentMarker, formatAiFileSize, parseAiAttachmentMarkers } from "./attachments";
import { aiTurnInputToContent } from "./http";

describe("attachment markers", () => {
  test("marker roundtrip", () => {
    const ref = { path: "/input/report.csv", mediaType: "text/csv", size: 48_200_000 };
    const marker = aiAttachmentMarker(ref);
    const parsed = parseAiAttachmentMarkers(`Please analyze this. ${marker}`);
    expect(parsed.text).toBe("Please analyze this.");
    expect(parsed.attachments).toEqual([ref]);
  });

  test("multiple markers and no markers", () => {
    const a = aiAttachmentMarker({ path: "/input/a.csv", mediaType: "text/csv", size: 1 });
    const b = aiAttachmentMarker({ path: "/input/b.pdf", mediaType: "application/pdf", size: 2 });
    expect(parseAiAttachmentMarkers(`${a}\n${b}`).attachments).toHaveLength(2);
    expect(parseAiAttachmentMarkers("plain text").attachments).toHaveLength(0);
    expect(parseAiAttachmentMarkers("plain text").text).toBe("plain text");
  });

  test("file size formatting", () => {
    expect(formatAiFileSize(512)).toBe("512 B");
    expect(formatAiFileSize(2048)).toBe("2.0 KB");
    expect(formatAiFileSize(50 * 1024 * 1024)).toBe("50.0 MB");
  });
});

describe("aiTurnInputToContent with attachments", () => {
  test("attachment parts become marker text parts", () => {
    const content = aiTurnInputToContent({
      message: "Analyze this file",
      content: [{ type: "attachment", path: "/input/data.csv", mediaType: "text/csv", size: 123 }],
    });
    expect(Array.isArray(content)).toBe(true);
    const parts = content as { type: string; text?: string }[];
    // Message is prepended because attachments-only content has no prose.
    expect(parts[0]).toEqual({ type: "text", text: "Analyze this file" });
    expect(parts[1]?.type).toBe("text");
    expect(parts[1]?.text).toContain('<attachment path="/input/data.csv"');
    const parsed = parseAiAttachmentMarkers(parts[1]?.text ?? "");
    expect(parsed.attachments[0]?.path).toBe("/input/data.csv");
  });

  test("prose content parts suppress message prepending", () => {
    const content = aiTurnInputToContent({
      message: "ignored",
      content: [
        { type: "text", text: "actual prompt" },
        { type: "attachment", path: "/input/x.bin", mediaType: "application/octet-stream", size: 1 },
      ],
    });
    const parts = content as { type: string; text?: string }[];
    expect(parts).toHaveLength(2);
    expect(parts[0]?.text).toBe("actual prompt");
  });
});
