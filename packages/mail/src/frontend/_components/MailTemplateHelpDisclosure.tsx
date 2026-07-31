import { clipboard } from "@k2b/stdlib/solid";
import type { JSX } from "solid-js";

export function MailTemplateToken(props: { value: string; muted?: boolean }) {
  const { copy, wasCopied } = clipboard.create();

  return (
    <button
      type="button"
      class={`focus-ui inline-flex items-center gap-1 rounded bg-[var(--ui-surface)] px-1.5 py-0.5 font-mono text-[11px] transition-colors hover:bg-[var(--ui-hover)] ${
        props.muted ? "text-dimmed" : "text-primary"
      }`}
      aria-label={wasCopied() ? `Copied ${props.value}` : `Copy ${props.value}`}
      title={wasCopied() ? "Copied" : "Click to copy"}
      onClick={() => void copy(props.value)}
    >
      <span>{props.value}</span>
      {wasCopied() ? <i class="ti ti-check text-green-600" aria-hidden="true" /> : null}
    </button>
  );
}

export default function MailTemplateHelpDisclosure(props: { title: string; children: JSX.Element }) {
  return (
    <details class="group rounded-[var(--ui-radius-surface)] border border-[var(--ui-border)] bg-[var(--ui-surface-subtle)]">
      <summary class="focus-ui flex cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--ui-radius-surface)] px-3 py-2 text-xs font-semibold text-primary">
        <span class="flex items-center gap-2">
          <i class="ti ti-info-circle text-dimmed" aria-hidden="true" />
          {props.title}
        </span>
        <i class="ti ti-chevron-down text-dimmed transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div class="px-3 pb-2.5 text-secondary">{props.children}</div>
    </details>
  );
}
