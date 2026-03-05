import { createSignal } from "solid-js";
import { clipboard } from "@valentinkolb/cloud/lib/browser";

type Props = {
  icalToken: string | null;
  variant?: "sidebar" | "chip";
};

export default function CopyICalButton(props: Props) {
  const [copied, setCopied] = createSignal(false);

  const icalUrl = () =>
    props.icalToken
      ? `${typeof window !== "undefined" ? window.location.origin : ""}/api/app/spaces/calendar/ical/${props.icalToken}.ics`
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
    <button type="button" onClick={handleCopy} class="sidebar-item w-full">
      <i class={`ti ${copied() ? "ti-check" : "ti-calendar-share"} text-sm`} />
      <span>{copied() ? "Copied!" : "Copy iCal URL"}</span>
    </button>
  );
}
