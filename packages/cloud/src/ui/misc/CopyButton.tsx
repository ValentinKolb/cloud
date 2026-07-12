import { copyToClipboard } from "@valentinkolb/stdlib/browser";
import { createSignal } from "solid-js";
import Tooltip from "./Tooltip";

type CopyButtonProps = {
  /** Text to copy to clipboard */
  text: string;
  /** Optional label - if omitted, renders icon-only */
  label?: string;
  /** Additional CSS classes */
  class?: string;
};

export default function CopyButton(props: CopyButtonProps) {
  const [copied, setCopied] = createSignal(false);

  const handleCopy = async () => {
    await copyToClipboard(props.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const button = () => (
    <button
      type="button"
      class={props.class ?? "btn-simple min-h-7 px-2 py-1 text-[11px]"}
      aria-label={props.label === undefined ? (copied() ? "Copied" : "Copy") : undefined}
      onClick={handleCopy}
    >
      <i class={copied() ? "ti ti-check" : "ti ti-copy"} />
      {props.label !== undefined && <span>{copied() ? "Copied" : props.label}</span>}
    </button>
  );

  return props.label === undefined ? (
    <Tooltip content={copied() ? "Copied" : "Copy"}>
      {button()}
      <span class="sr-only" aria-live="polite">
        {copied() ? "Copied" : ""}
      </span>
    </Tooltip>
  ) : (
    button()
  );
}
