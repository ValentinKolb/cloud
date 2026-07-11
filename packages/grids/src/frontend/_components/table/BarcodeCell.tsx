import { createMemo, Show } from "solid-js";
import type { FormatSpec } from "../../../contracts";
import { barcodeSvgForCell, barcodeSvgForDisplay, barcodeUrl, barcodeValueText } from "./BarcodeRendering";

type BarcodeFormat = Extract<FormatSpec, { kind: "barcode" }>;

export function BarcodeDisplay(props: { value: unknown; format: BarcodeFormat; size?: "table" | "detail"; showOpenAction?: boolean }) {
  const svg = createMemo(() => barcodeSvgForCell(props.value, props.format));
  const sizedSvg = createMemo(() => {
    const raw = svg();
    if (!raw) return null;
    return barcodeSvgForDisplay(raw, props.format, props.size ?? "table");
  });
  const fallback = () => barcodeValueText(props.value);
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
