import { describe, expect, test } from "bun:test";
import {
  DOCUMENT_EXTRACTION_MAX_INPUT_BYTES,
  DOCUMENT_EXTRACTION_MAX_OUTPUT_BYTES,
  DocumentExtractionError,
  documentFormatFromBytes,
  documentFormatFromFilename,
  extractDocumentMarkdown,
} from "./document-extraction";
import { DOCUMENT_EXTRACTION_FIXTURES } from "./document-extraction-fixtures.test";

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);
const fixtureBytes = (value: string): Uint8Array => Uint8Array.from(Buffer.from(value, "base64"));

const pdfBytes = (content: string): Uint8Array => {
  const stream = content ? `BT /F1 12 Tf 72 720 Td (${content}) Tj ET` : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let source = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = bytes(source).byteLength;
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = bytes(source).byteLength;
  source += `xref\n0 6\n0000000000 65535 f \n${offsets
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n `)
    .join("\n")}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return bytes(source);
};

describe("document extraction", () => {
  test("detects supported filenames without trusting unknown extensions", () => {
    expect(documentFormatFromFilename("report.DOCX")).toBe("docx");
    expect(documentFormatFromFilename("archive/report.csv")).toBe("csv");
    expect(documentFormatFromFilename("report.bin")).toBeNull();
    expect(documentFormatFromFilename(null)).toBeNull();
  });

  test("detects signed document bytes", () => {
    expect(documentFormatFromBytes(bytes("{\\rtf1\\ansi Cloud document}"))).toBe("rtf");
    expect(documentFormatFromBytes(bytes("not a signed document"))).toBeNull();
  });

  test("converts RTF bytes to bounded Markdown", async () => {
    const result = await extractDocumentMarkdown({
      bytes: bytes("{\\rtf1\\ansi\\b Cloud\\b0  document extraction}"),
      filename: "notes.rtf",
    });

    expect(result).toMatchObject({ format: "rtf", truncated: false });
    expect(result.markdown).toContain("**Cloud**");
    expect(result.markdown).toContain("document extraction");
    expect(result.outputBytes).toBeGreaterThan(0);
  });

  test("converts representative PDF, Office, and EPUB documents", async () => {
    const cases = [
      { filename: "sample.pdf", bytes: pdfBytes("Cloud PDF text"), format: "pdf", expected: "Cloud PDF text" },
      { filename: "sample.docx", bytes: fixtureBytes(DOCUMENT_EXTRACTION_FIXTURES.docx), format: "docx", expected: "Head A" },
      { filename: "sample.doc", bytes: fixtureBytes(DOCUMENT_EXTRACTION_FIXTURES.doc), format: "doc", expected: "Body before" },
      { filename: "sample.odt", bytes: fixtureBytes(DOCUMENT_EXTRACTION_FIXTURES.odt), format: "odt", expected: "Body before" },
      { filename: "sample.xlsx", bytes: fixtureBytes(DOCUMENT_EXTRACTION_FIXTURES.xlsx), format: "xlsx", expected: "Merged across" },
      { filename: "sample.ods", bytes: fixtureBytes(DOCUMENT_EXTRACTION_FIXTURES.ods), format: "ods", expected: "RowGap" },
      { filename: "sample.pptx", bytes: fixtureBytes(DOCUMENT_EXTRACTION_FIXTURES.pptx), format: "pptx", expected: "Relocated deck title" },
      { filename: "sample.ppt", bytes: fixtureBytes(DOCUMENT_EXTRACTION_FIXTURES.ppt), format: "ppt", expected: "First slide text" },
      { filename: "sample.odp", bytes: fixtureBytes(DOCUMENT_EXTRACTION_FIXTURES.odp), format: "odp", expected: "Deck Title Slide" },
      { filename: "sample.epub", bytes: fixtureBytes(DOCUMENT_EXTRACTION_FIXTURES.epub), format: "epub", expected: "Feature Book" },
    ] as const;

    for (const fixture of cases) {
      const result = await extractDocumentMarkdown({ bytes: fixture.bytes, filename: fixture.filename });
      expect(result.format).toBe(fixture.format);
      expect(result.markdown).toContain(fixture.expected);
    }
  });

  test("classifies encrypted, resource-limited, and textless PDF inputs", async () => {
    await expect(
      extractDocumentMarkdown({
        bytes: fixtureBytes(DOCUMENT_EXTRACTION_FIXTURES.encryptedOdt),
        filename: "encrypted.odt",
      }),
    ).rejects.toMatchObject({ code: "encrypted" });
    await expect(
      extractDocumentMarkdown({
        bytes: fixtureBytes(DOCUMENT_EXTRACTION_FIXTURES.resourceLimitOds),
        filename: "complex.ods",
      }),
    ).rejects.toMatchObject({ code: "resource_limit" });
    await expect(extractDocumentMarkdown({ bytes: pdfBytes(""), filename: "scan.pdf" })).rejects.toMatchObject({
      code: "ocr_required",
    });
  });

  test("uses the filename for signature-less CSV", async () => {
    const result = await extractDocumentMarkdown({ bytes: bytes("name,value\nalpha,42\n"), filename: "values.csv" });

    expect(result.format).toBe("csv");
    expect(result.markdown).toContain("| name | value |");
    expect(result.markdown).toContain("| alpha | 42 |");
  });

  test("does not trust a document extension without matching bytes", async () => {
    await expect(extractDocumentMarkdown({ bytes: bytes("not a PDF"), filename: "spoofed.pdf" })).rejects.toMatchObject({
      code: "unsupported",
    });
    await expect(extractDocumentMarkdown({ bytes: bytes("not a DOCX"), filename: "spoofed.docx" })).rejects.toMatchObject({
      code: "unsupported",
    });
  });

  test("truncates converted Markdown at a valid UTF-8 boundary", async () => {
    const content = `${"Cloud extraction 😀 ".repeat(60_000)}end`;
    const result = await extractDocumentMarkdown({ bytes: bytes(`{\\rtf1\\ansi ${content}}`), filename: "large.rtf" });

    expect(result.truncated).toBe(true);
    expect(result.outputBytes).toBeLessThanOrEqual(DOCUMENT_EXTRACTION_MAX_OUTPUT_BYTES);
    expect(new TextEncoder().encode(result.markdown).byteLength).toBe(result.outputBytes);
  });

  test("rejects empty, unsupported, oversized, and cancelled input with stable codes", async () => {
    await expect(extractDocumentMarkdown({ bytes: new Uint8Array() })).rejects.toMatchObject({ code: "malformed" });
    await expect(extractDocumentMarkdown({ bytes: bytes("plain binary") })).rejects.toMatchObject({ code: "unsupported" });
    await expect(
      extractDocumentMarkdown({ bytes: new Uint8Array(DOCUMENT_EXTRACTION_MAX_INPUT_BYTES + 1), filename: "large.rtf" }),
    ).rejects.toMatchObject({ code: "input_too_large" });

    const controller = new AbortController();
    controller.abort();
    await expect(extractDocumentMarkdown({ bytes: bytes("{\\rtf1 Cloud}"), signal: controller.signal })).rejects.toMatchObject({
      code: "cancelled",
    });
  });

  test("uses the public error type", () => {
    expect(new DocumentExtractionError("unsupported", "Unsupported")).toMatchObject({
      name: "DocumentExtractionError",
      code: "unsupported",
    });
  });
});
