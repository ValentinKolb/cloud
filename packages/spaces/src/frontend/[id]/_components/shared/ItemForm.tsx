import { createSignal, For, Show } from "solid-js";
import { EntitySearch, type EntitySearchPrincipal, TextInput } from "@valentinkolb/cloud/ui";
import { CheckboxCard } from "@valentinkolb/cloud/ui";
import { SelectInput } from "@valentinkolb/cloud/ui";
import { SegmentedControl } from "@valentinkolb/cloud/ui";
import { DateTimeInput } from "@valentinkolb/cloud/ui";
import type { SpaceColumn, SpaceItem, SpaceItemAssignee, SpaceTag } from "@/contracts";

type Priority = "low" | "medium" | "high" | "urgent";
type ItemType = "task" | "event";

export type ItemFormData = {
  columnId: string;
  title: string;
  description?: string;
  startsAt?: string;
  endsAt?: string;
  allDay?: boolean;
  deadline?: string;
  priority?: Priority | null;
  assigneeIds?: string[];
  tagIds?: string[];
};

type Props = {
  /** Existing item for edit mode, undefined for create mode */
  item?: SpaceItem;
  defaults?: Partial<ItemFormData> & { type?: ItemType };
  columns: SpaceColumn[];
  tags?: SpaceTag[];
  onSubmit: (data: ItemFormData) => void;
  onCancel: () => void;
  submitLabel?: string;
};

const PRIORITY_OPTIONS = [
  { id: "urgent", label: "Urgent", icon: "ti ti-alert-circle" },
  { id: "high", label: "High", icon: "ti ti-arrows-up" },
  { id: "medium", label: "Medium", icon: "ti ti-arrow-up" },
  { id: "low", label: "Low", icon: "ti ti-arrow-down" },
  { id: "", label: "None", icon: "ti ti-minus" },
];

/**
 * Unified form for creating and editing items.
 * - Create mode: item is undefined, shows type selector and tags
 * - Edit mode: item is provided, type is fixed based on existing data
 */
export default function ItemForm(props: Props) {
  const isEditMode = () => !!props.item;
  const initialIsEvent = () => Boolean(props.item?.startsAt && props.item?.endsAt);

  // Form state
  const [title, setTitle] = createSignal(props.item?.title ?? "");
  const [description, setDescription] = createSignal(props.item?.description ?? "");
  const [columnId, setColumnId] = createSignal(props.item?.columnId ?? props.defaults?.columnId ?? props.columns[0]?.id ?? "");
  const [itemType, setItemType] = createSignal<ItemType>(initialIsEvent() ? "event" : (props.defaults?.type ?? "task"));
  const [deadline, setDeadline] = createSignal(
    props.item?.deadline ? props.item.deadline.slice(0, 16) : (props.defaults?.deadline?.slice(0, 16) ?? ""),
  );
  const [startsAt, setStartsAt] = createSignal(
    props.item?.startsAt ? props.item.startsAt.slice(0, 16) : (props.defaults?.startsAt?.slice(0, 16) ?? ""),
  );
  const [endsAt, setEndsAt] = createSignal(
    props.item?.endsAt ? props.item.endsAt.slice(0, 16) : (props.defaults?.endsAt?.slice(0, 16) ?? ""),
  );
  const [allDay, setAllDay] = createSignal(props.item?.allDay ?? props.defaults?.allDay ?? false);
  const [priority, setPriority] = createSignal(props.item?.priority ?? props.defaults?.priority ?? "");
  const [assignees, setAssignees] = createSignal<SpaceItemAssignee[]>(props.item?.assignees ?? []);
  const [selectedTags, setSelectedTags] = createSignal<string[]>(props.item?.tags?.map((t) => t.id) ?? props.defaults?.tagIds ?? []);
  const [error, setError] = createSignal("");

  const isEvent = () => itemType() === "event";

  const columnOptions = () =>
    props.columns.map((c) => ({
      id: c.id,
      label: c.name,
      icon: "ti ti-layout-list",
    }));

  const defaultColumnId = () => props.columns[0]?.id ?? "";

  const toggleTag = (tagId: string) => {
    setSelectedTags((prev) => (prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]));
  };

  const addAssignee = (principal: EntitySearchPrincipal) => {
    if (principal.type !== "user") return;
    setAssignees((prev) => {
      if (prev.some((assignee) => assignee.id === principal.userId)) return prev;
      return [...prev, { id: principal.userId, displayName: principal.displayName }];
    });
  };

  const removeAssignee = (id: string) => {
    setAssignees((prev) => prev.filter((assignee) => assignee.id !== id));
  };

  const handleTypeChange = (type: ItemType) => {
    setItemType(type);
    if (type === "task") {
      setStartsAt("");
      setEndsAt("");
    } else {
      setDeadline("");
    }
  };

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    setError("");

    if (!title().trim()) {
      setError("Title is required");
      return;
    }

    if (!isEvent() && !columnId()) {
      setError("Please select a status");
      return;
    }

    if (isEvent()) {
      if (!startsAt() || !endsAt()) {
        setError("Events require both start and end time");
        return;
      }
      if (new Date(endsAt()) <= new Date(startsAt())) {
        setError("End time must be after start time");
        return;
      }
    }

    props.onSubmit({
      columnId: columnId() || defaultColumnId(),
      title: title().trim(),
      description: description().trim() || undefined,
      startsAt: isEvent() && startsAt() ? new Date(startsAt()).toISOString() : undefined,
      endsAt: isEvent() && endsAt() ? new Date(endsAt()).toISOString() : undefined,
      allDay: isEvent() ? allDay() : false,
      deadline: !isEvent() && deadline() ? new Date(deadline()).toISOString() : undefined,
      priority: (priority() || (isEditMode() ? null : undefined)) as Priority | null | undefined,
      assigneeIds: isEditMode() || assignees().length > 0 ? assignees().map((assignee) => assignee.id) : undefined,
      tagIds: isEditMode() || selectedTags().length > 0 ? selectedTags() : undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} class="flex max-h-[74vh] flex-col gap-4 overflow-y-auto pr-1">
      <div class="paper flex flex-col gap-4 p-3">
        <TextInput
          label="Title"
          description={!isEditMode() ? "A short summary of what needs to be done" : undefined}
          placeholder="What needs to be done?"
          icon="ti ti-text-caption"
          value={title}
          onInput={(v) => {
            setTitle(v);
            setError("");
          }}
          required
        />

        <TextInput
          label="Description"
          description={!isEditMode() ? "Optional details or notes" : undefined}
          placeholder="Description in markdown ..."
          value={description}
          onInput={setDescription}
          markdown
        />
      </div>

      <div class="paper flex flex-col gap-4 p-3">
        <Show when={!isEditMode()}>
          <div>
            <p class="block text-sm font-medium mb-1">Type</p>
            <p class="text-xs text-dimmed mb-2">Tasks have a deadline, events have a start and end time</p>
            <SegmentedControl
              options={[
                { value: "task" as const, label: "Task", icon: "ti ti-checkbox" },
                {
                  value: "event" as const,
                  label: "Event",
                  icon: "ti ti-calendar-event",
                },
              ]}
              value={itemType}
              onChange={handleTypeChange}
            />
          </div>
        </Show>

        <div class="grid grid-cols-2 gap-3">
          <SelectInput
            label="Kanban"
            description={!isEditMode() ? "Current workflow state" : undefined}
            placeholder="Select column"
            icon="ti ti-progress"
            value={columnId}
            onChange={setColumnId}
            options={columnOptions()}
            required={!isEvent()}
          />
          <SelectInput
            label="Priority"
            description={!isEditMode() ? "How urgent is this?" : undefined}
            placeholder="Select priority"
            icon="ti ti-flag"
            value={priority}
            onChange={setPriority}
            options={PRIORITY_OPTIONS}
            clearable
          />
        </div>

        <Show when={!isEvent()}>
          <DateTimeInput
            label="Deadline"
            description={!isEditMode() ? "When should this be completed?" : undefined}
            value={deadline}
            onChange={setDeadline}
          />
        </Show>

        <Show when={isEvent()}>
          <div class="flex flex-col gap-3">
            <CheckboxCard
              label="All-day event"
              description="Show this in the all-day calendar row"
              icon="ti ti-calendar"
              value={allDay}
              onChange={setAllDay}
            />
            <div class="grid grid-cols-2 gap-3">
              <DateTimeInput
                label="Start"
                description={!isEditMode() ? "When does it start?" : undefined}
                value={startsAt}
                onChange={(v) => {
                  setStartsAt(v);
                  setError("");
                }}
                required
              />
              <DateTimeInput
                label="End"
                description={!isEditMode() ? "When does it end?" : undefined}
                value={endsAt}
                onChange={(v) => {
                  setEndsAt(v);
                  setError("");
                }}
                required
              />
            </div>
          </div>
        </Show>
      </div>

      <div class="paper flex flex-col gap-4 p-3">
        <Show when={props.tags && props.tags.length > 0}>
          <div>
            <p class="block text-sm font-medium mb-1">Tags</p>
            <Show when={!isEditMode()}>
              <p class="text-xs text-dimmed mb-2">Categorize with tags</p>
            </Show>
            <div class="flex flex-wrap gap-2">
              <For each={props.tags}>
                {(tag) => (
                  <button
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    class={`px-2 py-1 rounded-full text-xs flex items-center gap-1 transition-all ${
                      selectedTags().includes(tag.id) ? "opacity-100" : "opacity-40 hover:opacity-70"
                    }`}
                    style={`background-color: ${tag.color}${selectedTags().includes(tag.id) ? "30" : "15"}; color: ${tag.color}`}
                  >
                    <span class="w-2 h-2 rounded-full" style={`background-color: ${tag.color}`} />
                    {tag.name}
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>

        <div class="flex flex-col gap-3">
          <p class="mb-1 block text-sm font-medium">Assignees</p>
          <p class="mb-2 text-xs text-dimmed">Assign initial owners or leave unassigned</p>
          <Show when={assignees().length > 0}>
            <div class="mb-2 flex flex-wrap gap-2">
              <For each={assignees()}>
                {(assignee) => (
                  <span class="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2 py-1 text-xs dark:bg-zinc-800">
                    <span class="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-200 text-[10px] dark:bg-zinc-700">
                      {assignee.displayName.charAt(0).toUpperCase()}
                    </span>
                    <span>{assignee.displayName}</span>
                    <button type="button" onClick={() => removeAssignee(assignee.id)} class="text-dimmed hover:text-red-500">
                      <i class="ti ti-x text-xs" />
                    </button>
                  </span>
                )}
              </For>
            </div>
          </Show>
          <EntitySearch
            includeUsers
            excludeUserIds={assignees().map((assignee) => assignee.id)}
            onSelect={addAssignee}
            placeholder="Search users to assign..."
            resultsHeightClass="h-36"
          />
        </div>
      </div>

      {/* Error */}
      <Show when={error()}>
        <div class="text-sm text-red-500 flex items-center gap-1">
          <i class="ti ti-alert-circle" />
          {error()}
        </div>
      </Show>

      {/* Actions */}
      <div class="flex justify-end gap-2 pt-2">
        <button type="button" onClick={props.onCancel} class="btn-secondary btn-sm">
          Cancel
        </button>
        <button type="submit" class="btn-primary btn-sm">
          {props.submitLabel ?? (isEditMode() ? "Save" : "Create Item")}
        </button>
      </div>
    </form>
  );
}
