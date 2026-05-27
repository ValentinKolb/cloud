import { createSignal } from "solid-js";
import { clipboard } from "@valentinkolb/stdlib/browser";
import { AppWorkspace } from "@valentinkolb/cloud/ui";

type Props = {
  icalToken: string | null;
  variant?: "sidebar" | "chip";
};

export default function CopyICalButton(props: Props) {
  const [copied, setCopied] = createSignal(false);

  const icalUrl = () =>
    props.icalToken
      ? `${typeof window !== "undefined" ? window.location.origin : ""}/api/spaces/calendar/ical/${props.icalToken}.ics`
      : null;

  const handleCopy = async () => {
    const url = icalUrl();
    if (url) {
      await clipboard.copy(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!icalUrl()) return null;

  if (props.variant === "chip") {
    return (
      <button type="button" onClick={handleCopy} class="btn-input btn-input-sm">
        <i class={`ti ${copied() ? "ti-check" : "ti-calendar-share"}`} />
        <span>{copied() ? "Copied!" : "iCal URL"}</span>
      </button>
    );
  }

  return (
    <AppWorkspace.SidebarItem onClick={handleCopy} icon={copied() ? "ti ti-check" : "ti ti-calendar-share"}>
      {copied() ? "Copied!" : "Copy iCal URL"}
    </AppWorkspace.SidebarItem>
  );
}
