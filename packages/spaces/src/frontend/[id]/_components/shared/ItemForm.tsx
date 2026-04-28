import { createSignal, For, Show } from "solid-js";
import { TextInput } from "@valentinkolb/cloud/ui";
import { SelectInput } from "@valentinkolb/cloud/ui";
import { SegmentedControl } from "@valentinkolb/cloud/ui";
import { DateTimeInput } from "@valentinkolb/cloud/ui";
import type { SpaceItem, SpaceColumn, SpaceTag } from "@/contracts";

type Priority = "low" | "medium" | "high" | "urgent";
type ItemType = "task" | "event";

export type ItemFormData = {
  columnId: string;
  title: string;
  description?: string;
  startsAt?: string;
  endsAt?: string;
  deadline?: string;
  priority?: Priority;
  tagIds?: string[];
};

type Props = {
  /** Existing item for edit mode, undefined for create mode */
  item?: SpaceItem;
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
  const [columnId, setColumnId] = createSignal(props.item?.columnId ?? props.columns[0]?.id ?? "");
  const [itemType, setItemType] = createSignal<ItemType>(initialIsEvent() ? "event" : "task");
  const [deadline, setDeadline] = createSignal(props.item?.deadline ? props.item.deadline.slice(0, 16) : "");
  const [startsAt, setStartsAt] = createSignal(props.item?.startsAt ? props.item.startsAt.slice(0, 16) : "");
  const [endsAt, setEndsAt] = createSignal(props.item?.endsAt ? props.item.endsAt.slice(0, 16) : "");
  const [priority, setPriority] = createSignal(props.item?.priority ?? "");
  const [selectedTags, setSelectedTags] = createSignal<string[]>(props.item?.tags?.map((t) => t.id) ?? []);
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
      deadline: !isEvent() && deadline() ? new Date(deadline()).toISOString() : undefined,
      priority: (priority() || undefined) as Priority | undefined,
      tagIds: selectedTags().length > 0 ? selectedTags() : undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} class="flex flex-col gap-4">
      {/* Title */}
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

      {/* Description */}
      <TextInput
        label="Description"
        description={!isEditMode() ? "Optional details or notes" : undefined}
        placeholder="Description in markdown ..."
        value={description}
        onInput={setDescription}
        markdown
      />

      {/* Item Type - only in create mode */}
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

      {/* Status + Priority (always visible) */}
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

      {/* Deadline (Tasks only) */}
      <Show when={!isEvent()}>
        <DateTimeInput
          label="Deadline"
          description={!isEditMode() ? "When should this be completed?" : undefined}
          value={deadline}
          onChange={setDeadline}
        />
      </Show>

      {/* Event time (Events only) */}
      <Show when={isEvent()}>
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
      </Show>

      {/* Tags - only in create mode or if tags provided */}
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
