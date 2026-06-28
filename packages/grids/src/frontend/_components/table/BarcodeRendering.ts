import type { FormatSpec } from "../../../service/views";
export { barcodeSvgForCell, barcodeUrl, barcodeValueText, canRenderBarcode } from "../../../barcode-rendering";

type BarcodeFormat = Extract<FormatSpec, { kind: "barcode" }>;

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
