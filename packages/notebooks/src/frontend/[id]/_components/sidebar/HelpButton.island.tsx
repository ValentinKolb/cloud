import { openLayoutHelpDialog } from "@valentinkolb/cloud/ssr/islands";

type Variant = "sidebar" | "sidebar-mobile";

type Props = {
  variant: Variant;
};

export default function HelpButton(props: Props) {
  if (props.variant === "sidebar-mobile") {
    return (
      <button type="button" class="sidebar-item-mobile w-full" onClick={() => openLayoutHelpDialog()}>
        <i class="ti ti-help" />
        Help
      </button>
    );
  }
  return (
    <button type="button" class="sidebar-item w-full text-xs" onClick={() => openLayoutHelpDialog()} title="How this app works">
      <i class="ti ti-help text-sm" />
      <span class="flex-1 text-left">Help</span>
    </button>
  );
}
