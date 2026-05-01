import { Show } from "solid-js";
import { prompts, refreshCurrentPath } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { apiClient } from "@/api/client";
import type { Field, GridRecord } from "../../service";

type Props = {
  tableId: string;
  fields: Field[];
  canWrite: boolean;
};

const errorMessage = async (res: Response, fallback: string): Promise<string> => {
  try {
    const data = (await res.json()) as { message?: string };
    if (typeof data.message === "string" && data.message.length > 0) return data.message;
  } catch {}
  return fallback;
};

/**
 * Returns true for field types that QuickAdd can render an input for.
 * System / computed types (autonumber, formula, etc.) are skipped — they're
 * either auto-populated server-side or read-only.
 */
const isQuickAddable = (type: string): boolean => {
  return [
    "text", "longtext", "number", "decimal", "rating",
    "boolean", "date", "single-select", "multi-select",
  ].includes(type);
};

/**
 * Builds a prompts.form schema entry for a single grids field. Maps the
 * grids field-type to the closest prompts.form input type. Per-type config
 * (selects' options, dates' format) is passed through.
 */
const fieldToPromptSchema = (field: Field): any => {
  const required = field.required;
  const label = field.name;
  switch (field.type) {
    case "text":
      return { type: "text", label, required };
    case "longtext":
      return { type: "text", label, required, multiline: true, lines: 4 };
    case "number":
      return { type: "number", label, required };
    case "decimal":
      // No native decimal input in prompts.form; use number — server validates.
      return { type: "number", label, required };
    case "rating": {
      const scale = (field.config as { scale?: number }).scale ?? 5;
      return { type: "number", label, required, min: 0, max: scale };
    }
    case "boolean":
      return { type: "boolean", label };
    case "date": {
      const includeTime = (field.config as { includeTime?: boolean }).includeTime ?? false;
      return { type: "datetime", label, required, dateOnly: !includeTime };
    }
    case "single-select": {
      const options = ((field.config as { options?: Array<{ id: string; label: string }> }).options ?? []).map((o) => ({
        id: o.id, label: o.label,
      }));
      return { type: "select", label, required, options, clearable: !required };
    }
    case "multi-select": {
      // prompts.form's "tags" accepts free-text string[]. We don't constrain
      // to defined options here — the server rejects unknown ids cleanly.
      return { type: "tags", label };
    }
    default:
      return null;
  }
};

export default function QuickAdd(props: Props) {
  const createMutation = mutations.create<GridRecord, Record<string, unknown>>({
    mutation: async (payload) => {
      const res = await apiClient.records["by-table"][":tableId"].$post({
        param: { tableId: props.tableId },
        json: payload,
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to create record"));
      return (await res.json()) as GridRecord;
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (e) => prompts.error(e.message),
  });

  const handleClick = async () => {
    const usableFields = props.fields.filter((f) => !f.deletedAt && isQuickAddable(f.type));

    if (usableFields.length === 0) {
      prompts.error("This table has no editable fields. Add at least one field first.");
      return;
    }

    const formFields: Record<string, any> = {};
    for (const field of usableFields) {
      const schema = fieldToPromptSchema(field);
      if (schema) formFields[field.id] = schema;
    }

    const result = await prompts.form({
      title: "New record",
      icon: "ti ti-row-insert-bottom",
      fields: formFields,
      confirmText: "Create",
    });
    if (!result) return;

    // Strip empty values so the server applies defaults / leaves them null.
    // Keep `false` and `0` which are meaningful for boolean / number.
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(result)) {
      if (v === "" || v === undefined) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      payload[k] = v;
    }
    createMutation.mutate(payload);
  };

  return (
    <Show when={props.canWrite}>
      <button
        type="button"
        class="btn-primary btn-sm"
        onClick={handleClick}
        disabled={createMutation.loading()}
        title="Add a new record"
      >
        <Show when={createMutation.loading()} fallback={<i class="ti ti-plus" />}>
          <i class="ti ti-loader-2 animate-spin" />
        </Show>
        Add row
      </button>
    </Show>
  );
}
