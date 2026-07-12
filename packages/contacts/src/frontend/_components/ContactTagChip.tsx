import { safeTagColor } from "../../shared";

type ContactTagChipProps = {
  name: string;
  color: string;
  active?: boolean;
  size?: "xs" | "sm";
  class?: string;
};

export default function ContactTagChip(props: ContactTagChipProps) {
  const sizeClass = () => (props.size === "sm" ? "h-6 px-2 text-xs" : "h-5 px-1.5 text-[11px]");
  const color = () => safeTagColor(props.color);

  return (
    <span
      class={`inline-flex min-w-0 items-center gap-1.5 rounded-full border font-medium leading-none ${sizeClass()} ${props.class ?? ""}`}
      style={`background-color: ${color()}${props.active ? "24" : "14"}; border-color: ${color()}${props.active ? "70" : "2e"}; color: ${color()}`}
    >
      <span class="h-1.5 w-1.5 shrink-0 rounded-full" style={`background-color: ${color()}`} />
      <span class="truncate">{props.name}</span>
    </span>
  );
}
