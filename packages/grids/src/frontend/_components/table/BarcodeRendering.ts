import { toSVG } from "@bwip-js/generic";
import { qr } from "@valentinkolb/stdlib/qr";
import type { FormatSpec } from "../../../service/views";

type BarcodeFormat = Extract<FormatSpec, { kind: "barcode" }>;

export const barcodeValueText = (value: unknown): string => {
  if (Array.isArray(value)) return barcodeValueText(value[0]);
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
};

export const barcodeUrl = (value: unknown): string | null => {
  const text = barcodeValueText(value).trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
};

export const barcodeSvgForCell = (value: unknown, format: BarcodeFormat): string | null => {
  const text = barcodeValueText(value).trim();
  if (!text) return null;
  try {
    if (format.bcid === "qrcode") {
      return qr.toSvg(text, { on: "currentColor", off: "transparent", correctionLevel: "M" });
    }
    return toSVG({
      bcid: format.bcid,
      text,
      scale: 2,
      height: 12,
      includetext: Boolean(format.showText),
      textsize: 8,
    }).replaceAll("#000000", "currentColor");
  } catch {
    return null;
  }
};

export const canRenderBarcode = (type: string): boolean => type === "text" || type === "id" || type === "formula" || type === "lookup";

export const barcodeSvgForDisplay = (svg: string, format: BarcodeFormat, size: "table" | "detail") => {
  const isQr = format.bcid === "qrcode";
  const svgStyle =
    size === "detail"
      ? isQr
        ? "display:block;width:min(18rem,70vw);height:min(18rem,70vw);"
        : "display:block;width:min(100%,28rem);height:auto;max-height:8rem;"
      : isQr
        ? "display:block;width:2rem;height:2rem;"
        : "display:block;height:2.25rem;width:auto;max-width:10rem;";
  return svg.replace("<svg ", `<svg style="${svgStyle}" `);
};
