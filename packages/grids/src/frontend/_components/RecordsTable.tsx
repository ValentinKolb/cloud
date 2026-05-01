import type { Field, GridRecord } from "../../service";

const formatCell = (value: unknown, type: string): string => {
  if (value === null || value === undefined || value === "") return "";
  if (type === "boolean") return value ? "Yes" : "No";
  if (type === "multi-select" && Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

type Props = {
  fields: Field[];
  records: GridRecord[];
};

/**
 * Read-only table view for Phase 1A: renders the active fields in their
 * declared order with each record's data. Edit / inline forms / filter
 * arrive in 1B / 1C.
 */
export default function RecordsTable(props: Props) {
  const visibleFields = props.fields.filter((f) => !f.deletedAt);

  if (visibleFields.length === 0) {
    return (
      <div class="paper p-6 text-center text-sm text-dimmed">
        No fields. Create one via the API to populate this table.
      </div>
    );
  }

  return (
    <div class="paper overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-700">
          <tr>
            {visibleFields.map((f) => (
              <th class="text-left px-3 py-2 font-medium text-secondary">
                <span class="inline-flex items-center gap-1.5">
                  {f.name}
                  <span class="text-[10px] text-dimmed font-normal">{f.type}</span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.records.length === 0 ? (
            <tr>
              <td colspan={visibleFields.length} class="px-3 py-8 text-center text-dimmed text-sm">
                No records.
              </td>
            </tr>
          ) : (
            props.records.map((rec) => (
              <tr class="border-b border-zinc-100 dark:border-zinc-800 last:border-0">
                {visibleFields.map((f) => (
                  <td class="px-3 py-2 text-primary">{formatCell(rec.data[f.id], f.type)}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
