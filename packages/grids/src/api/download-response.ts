export const encodeHeaderValue = (value: string): string =>
  encodeURIComponent(value).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

const contentDispositionFilename = (disposition: "attachment" | "inline", filename: string): string => {
  const safeFilename =
    filename
      .replace(/[\r\n]/g, " ")
      .replace(/[/:*?"<>|\\]/g, "-")
      .replace(/\s+/g, " ")
      .trim() || "document.pdf";
  const fallback =
    safeFilename
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[\r\n"\\]/g, "_")
      .replace(/[^\x20-\x7E]/g, "_")
      .trim() || "document.pdf";
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeHeaderValue(safeFilename)}`;
};

export const pdfResponse = (
  pdf: Uint8Array,
  filename: string,
  headers: Record<string, string> = {},
  disposition: "attachment" | "inline" = "attachment",
) =>
  new Response(new Blob([pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer], { type: "application/pdf" }), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDispositionFilename(disposition, filename),
      "Cache-Control": "no-store",
      ...headers,
    },
  });
