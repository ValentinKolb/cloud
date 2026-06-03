import { Combobox, type ComboboxOption } from "@valentinkolb/cloud/ui";
import { For, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { SpaceItemAssignee } from "@/contracts";

type SpaceAssigneePickerProps = {
  spaceId: string;
  value: () => SpaceItemAssignee[];
  onChange: (assignees: SpaceItemAssignee[]) => void;
  disabled?: boolean;
  placeholder?: string;
  variant?: "chips" | "rows";
};

const selectedIds = (assignees: SpaceItemAssignee[]) => assignees.map((assignee) => assignee.id);

const removeAssignee = (assignees: SpaceItemAssignee[], id: string) => assignees.filter((assignee) => assignee.id !== id);

export default function SpaceAssigneePicker(props: SpaceAssigneePickerProps) {
  const variant = () => props.variant ?? "chips";
  const current = () => props.value();

  const fetchAssignableUsers = async (query: string, signal: AbortSignal): Promise<ComboboxOption[]> => {
    const res = await apiClient[":id"]["assignable-users"].$get(
      {
        param: { id: props.spaceId },
        query: {
          search: query,
          exclude_user_ids: selectedIds(current()).join(","),
        },
      },
      { init: { signal } },
    );
    if (!res.ok) throw new Error("Could not load assignable users");
    const users = await res.json();
    return users.map((user) => ({
      id: user.id,
      label: user.displayName,
      description: user.description,
      icon: "ti-user",
    }));
  };

  const addAssignee = (option: ComboboxOption) => {
    if (current().some((assignee) => assignee.id === option.id)) return;
    props.onChange([...current(), { id: option.id, displayName: option.label }]);
  };

  const remove = (id: string) => props.onChange(removeAssignee(current(), id));

  return (
    <div class="flex flex-col gap-2">
      <Show when={current().length > 0}>
        <Show
          when={variant() === "rows"}
          fallback={
            <div class="flex flex-wrap gap-2">
              <For each={current()}>
                {(assignee) => (
                  <span class="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2 py-1 text-xs dark:bg-zinc-800">
                    <span class="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-200 text-[10px] dark:bg-zinc-700">
                      {assignee.displayName.charAt(0).toUpperCase()}
                    </span>
                    <span>{assignee.displayName}</span>
                    <button
                      type="button"
                      onClick={() => remove(assignee.id)}
                      disabled={props.disabled}
                      class="text-dimmed hover:text-red-500 disabled:opacity-50"
                      aria-label={`Remove ${assignee.displayName}`}
                    >
                      <i class="ti ti-x text-xs" />
                    </button>
                  </span>
                )}
              </For>
            </div>
          }
        >
          <div class="flex flex-col gap-1">
            <For each={current()}>
              {(assignee) => (
                <div class="group flex items-center gap-2">
                  <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs dark:bg-zinc-700">
                    {assignee.displayName.charAt(0).toUpperCase()}
                  </div>
                  <div class="min-w-0 flex-1">
                    <span class="block truncate text-sm">{assignee.displayName}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(assignee.id)}
                    disabled={props.disabled}
                    class="p-1 text-zinc-400 opacity-0 transition-all hover:text-red-500 group-hover:opacity-100 disabled:opacity-50"
                    aria-label={`Remove ${assignee.displayName}`}
                  >
                    <i class="ti ti-x text-sm" />
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>

      <Combobox
        placeholder={props.placeholder ?? "Search people with access..."}
        fetchData={fetchAssignableUsers}
        onSelect={addAssignee}
        disabled={props.disabled}
      />
    </div>
  );
}
