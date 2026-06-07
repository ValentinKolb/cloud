import { createResource, Show } from "solid-js";
import type { FormatSpec } from "../../../service/views";

type BarcodeFormat = Extract<FormatSpec, { kind: "barcode" }>;

let bwip: Promise<typeof import("@bwip-js/generic")> | null = null;

const loadBwip = () => {
  bwip ??= import("@bwip-js/generic");
  return bwip;
};

const barcodeText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
};

const toSvg = async (value: unknown, format: BarcodeFormat): Promise<string | null> => {
  const text = barcodeText(value).trim();
  if (!text) return null;
  try {
    const mod = await loadBwip();
    return mod.toSVG({
      bcid: format.bcid,
      text,
      scale: 2,
      height: 12,
      includetext: Boolean(format.showText),
      textsize: 8,
    });
  } catch {
    return null;
  }
};

export const canRenderBarcode = (type: string): boolean => type === "text" || type === "id" || type === "formula";

export function BarcodeCell(props: { value: unknown; format: BarcodeFormat }) {
  const [svg] = createResource(
    () => ({ value: props.value, format: props.format }),
    ({ value, format }) => toSvg(value, format),
  );
  const fallback = () => barcodeText(props.value);

  return (
    <Show
      when={svg()}
      fallback={
        <span class="font-mono text-sm text-primary" title={fallback()}>
          {fallback()}
        </span>
      }
    >
      {(html) => (
        <span
          class="block h-12 max-w-64 overflow-hidden [&_svg]:h-12 [&_svg]:max-w-full [&_svg]:text-primary"
          title={fallback()}
          innerHTML={html()}
        />
      )}
    </Show>
  );
}
