import { copyToClipboard } from "@k2b/stdlib/browser";
import { createSignal, type JSX, onCleanup, Show, splitProps } from "solid-js";
import { Button, type ButtonProps, IconButton } from "./Button";

export type CopyButtonProps = Omit<ButtonProps, "children" | "onClick"> & {
  value: string;
  label?: string;
  copiedLabel?: string;
  iconOnly?: boolean;
  onCopied?: () => void;
  resetAfter?: number;
};

export function CopyButton(props: CopyButtonProps): JSX.Element {
  const [local, rest] = splitProps(props, ["copiedLabel", "iconOnly", "label", "onCopied", "resetAfter", "value"]);
  const [copied, setCopied] = createSignal(false);
  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  onCleanup(() => {
    if (resetTimer) clearTimeout(resetTimer);
  });

  const copy = async () => {
    try {
      await copyToClipboard(local.value);
    } catch {
      return;
    }

    setCopied(true);
    local.onCopied?.();
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => setCopied(false), local.resetAfter ?? 1600);
  };

  const label = () => (copied() ? (local.copiedLabel ?? "Copied") : (local.label ?? "Copy"));
  const icon = () => (copied() ? "ti ti-check" : "ti ti-copy");

  return (
    <Show
      when={local.iconOnly}
      fallback={
        <Button {...rest} onClick={copy}>
          <i class={icon()} aria-hidden="true" />
          {label()}
        </Button>
      }
    >
      <IconButton {...rest} label={label()} onClick={copy}>
        <i class={icon()} aria-hidden="true" />
      </IconButton>
    </Show>
  );
}
