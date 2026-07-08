import { Show } from "solid-js";

type Props = {
  href: string | null;
  sourceAccess?: "open" | "dashboard";
};

export default function SourceAccessHint(props: Props) {
  return (
    <Show
      when={props.href}
      fallback={
        <Show when={props.sourceAccess === "dashboard"}>
          <span
            class="text-[11px] text-dimmed inline-flex items-center gap-1 shrink-0"
            title="You can read this dashboard, not the source view."
          >
            <i class="ti ti-lock text-[10px]" />
            <span>Dashboard only</span>
          </span>
        </Show>
      }
    >
      {(href) => (
        <a href={href()} class="text-[11px] text-dimmed hover:text-primary inline-flex items-center gap-1 shrink-0">
          <span>Open full view</span>
          <i class="ti ti-arrow-up-right text-[10px]" />
        </a>
      )}
    </Show>
  );
}
