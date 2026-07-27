import { copyToClipboard } from "@k2b/stdlib/browser";
import { createSignal, type JSX, onCleanup, Show, splitProps } from "solid-js";
import { Tooltip } from "../feedback/Tooltip";
import { Button, type ButtonProps, IconButton } from "./Button";

type CopyValue = { text: string; value?: string } | { text?: string; value: string };

export type CopyButtonProps = CopyValue &
  Omit<ButtonProps, "children" | "onClick"> & {
    label?: string;
    copiedLabel?: string;
    iconOnly?: boolean;
    onCopied?: () => void;
    onCopyError?: (error: unknown) => void;
    resetAfter?: number;
  };

export function CopyButton(props: CopyButtonProps): JSX.Element {
  const [local, rest] = splitProps(props, ["copiedLabel", "iconOnly", "label", "onCopied", "onCopyError", "resetAfter", "text", "value"]);
  const [copied, setCopied] = createSignal(false);
  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  onCleanup(() => {
    if (resetTimer) clearTimeout(resetTimer);
  });

  const copy = async () => {
    try {
      await copyToClipboard(local.text ?? local.value ?? "");
    } catch (error) {
      local.onCopyError?.(error);
      return;
    }
    setCopied(true);
    local.onCopied?.();
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => setCopied(false), local.resetAfter ?? 2000);
  };

  const visibleLabel = () => (copied() ? (local.copiedLabel ?? "Copied") : (local.label ?? "Copy"));
  const icon = () => (copied() ? "ti ti-check" : "ti ti-copy");
  const iconOnly = () => local.iconOnly ?? local.label === undefined;
  const button = () => (
    <Show
      when={iconOnly()}
      fallback={
        <Button {...rest} onClick={copy}>
          <i class={icon()} aria-hidden="true" />
          {visibleLabel()}
        </Button>
      }
    >
      <IconButton {...rest} label={visibleLabel()} onClick={copy}>
        <i class={icon()} aria-hidden="true" />
      </IconButton>
    </Show>
  );

  return (
    <Show when={iconOnly()} fallback={button()}>
      <Tooltip content={visibleLabel()}>
        {button()}
        <span class="k2b-sr-only" aria-live="polite">
          {copied() ? visibleLabel() : ""}
        </span>
      </Tooltip>
    </Show>
  );
}

export default CopyButton;
