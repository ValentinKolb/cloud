import { SelectChip } from "@k2b/ui";
import type { CardSize } from "../records-view/query-url";

const cardSizeOptions: Array<{ value: CardSize; label: string; icon: string }> = [
  { value: "small", label: "Small cards", icon: "ti ti-layout-grid" },
  { value: "medium", label: "Medium cards", icon: "ti ti-layout-cards" },
  { value: "large", label: "Large cards", icon: "ti ti-square" },
];

export function CardSizeDropdown(props: { value: CardSize; onChange: (size: CardSize) => void }) {
  const selected = () => cardSizeOptions.find((option) => option.value === props.value) ?? cardSizeOptions[1]!;

  return (
    <SelectChip<CardSize>
      aria-label="Card size"
      value={() => props.value}
      onValueChange={props.onChange}
      icon={selected().icon}
      position="bottom-right"
      options={cardSizeOptions.map(({ value, label, icon }) => ({ value, label, icon }))}
    />
  );
}
