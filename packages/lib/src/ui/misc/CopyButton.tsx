import { createSignal } from "solid-js";
import { copyToClipboard } from "@/browser/client-utils";

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

  return (
    <button type="button" class={props.class ?? "btn-simple text-[10px] px-1.5 py-0.5"} onClick={handleCopy}>
      <i class={copied() ? "ti ti-check" : "ti ti-copy"} />
      {props.label !== undefined && <span>{copied() ? "Copied" : props.label}</span>}
    </button>
  );
}
