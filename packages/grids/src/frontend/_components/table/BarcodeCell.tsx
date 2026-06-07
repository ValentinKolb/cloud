import { createMemo, Show } from "solid-js";
import { toSVG } from "@bwip-js/generic";
import { qr } from "@valentinkolb/stdlib/qr";
import type { FormatSpec } from "../../../service/views";

type BarcodeFormat = Extract<FormatSpec, { kind: "barcode" }>;

const barcodeText = (value: unknown): string => {
  if (Array.isArray(value)) return barcodeText(value[0]);
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
};

export const barcodeValueText = barcodeText;

export const barcodeUrl = (value: unknown): string | null => {
  const text = barcodeText(value).trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
};

export const barcodeSvgForCell = (value: unknown, format: BarcodeFormat): string | null => {
  const text = barcodeText(value).trim();
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

export function BarcodeDisplay(props: { value: unknown; format: BarcodeFormat; size?: "table" | "detail"; showOpenAction?: boolean }) {
  const svg = createMemo(() => barcodeSvgForCell(props.value, props.format));
  const sizedSvg = createMemo(() => {
    const raw = svg();
    if (!raw) return null;
    return barcodeSvgForDisplay(raw, props.format, props.size ?? "table");
  });
  const fallback = () => barcodeText(props.value);
  const openUrl = () => barcodeUrl(props.value);
  const detail = () => props.size === "detail";
  const svgClass = () =>
    [
      "grids-code-display",
      detail() ? "grids-code-display--detail" : "grids-code-display--table",
      props.format.bcid === "qrcode" ? "grids-code-display--qr" : "grids-code-display--linear",
    ].join(" ");
  const fallbackClass = () => (detail() ? "font-mono text-base font-semibold text-primary" : "font-mono text-sm text-primary");
  const openButton = () => (
    <Show when={props.showOpenAction && sizedSvg() && openUrl()}>
      {(url) => (
        <a
          href={url()}
          target="_blank"
          rel="noopener noreferrer"
          class={detail() ? "btn-input btn-input-sm w-fit" : "btn-simple btn-sm text-dimmed hover:text-primary"}
          title="Open URL"
          aria-label="Open URL"
          onClick={(event) => event.stopPropagation()}
        >
          <i class="ti ti-external-link" />
          <Show when={detail()}>
            <span>Open</span>
          </Show>
        </a>
      )}
    </Show>
  );

  return (
    <span class={detail() ? "flex min-w-0 flex-col gap-3" : "inline-flex min-w-0 items-center gap-1.5 align-middle"}>
      <Show
        when={sizedSvg()}
        fallback={
          <Show
            when={openUrl()}
            fallback={
              <span class={fallbackClass()} title={fallback()}>
                {fallback()}
              </span>
            }
          >
            {(url) => (
              <a
                href={url()}
                target="_blank"
                rel="noopener noreferrer"
                class={`${fallbackClass()} hover:underline`}
                title={fallback()}
                onClick={(event) => event.stopPropagation()}
              >
                {fallback()}
              </a>
            )}
          </Show>
        }
      >
        {(html) => <span class={svgClass()} title={fallback()} innerHTML={html()} />}
      </Show>
      {openButton()}
    </span>
  );
}

export function BarcodeCell(props: { value: unknown; format: BarcodeFormat }) {
  return <BarcodeDisplay value={props.value} format={props.format} size="table" showOpenAction />;
}
