import { SelectInput } from "@valentinkolb/cloud/ui";
import { fetchRecordLookup } from "./record-lookup";

type Props = {
  tableId: string;
  value: () => string;
  onChange: (recordId: string) => void;
  label?: string;
  description?: string;
  placeholder?: string;
  selectedLabel?: () => string | undefined;
  disabled?: () => boolean;
  excludeIds?: () => string[];
  clearable?: boolean;
};

export default function RecordPicker(props: Props) {
  const excludedIds = () => [...new Set([props.value(), ...(props.excludeIds?.() ?? [])].filter(Boolean))];

  return (
    <SelectInput
      label={props.label}
      description={props.description}
      placeholder={props.placeholder ?? "Search records..."}
      icon="ti ti-database"
      activeIcon="ti ti-search"
      clearable={props.clearable ?? true}
      disabled={props.disabled?.() ?? false}
      value={() => props.value()}
      onChange={props.onChange}
      selectedLabel={props.selectedLabel}
      fetchData={async (query, signal) => {
        const items = await fetchRecordLookup({
          tableId: props.tableId,
          query,
          excludeIds: excludedIds(),
          signal,
        });
        return items.map((item) => ({ id: item.id, label: item.label, icon: "ti ti-database" }));
      }}
    />
  );
}
