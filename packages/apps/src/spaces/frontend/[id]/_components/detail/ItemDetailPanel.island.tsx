import { Show, For, createSignal } from "solid-js";
import { apiClient } from "@/spaces/client";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { mutation as mutations } from "@valentinkolb/cloud/lib/browser";
import { dates, markdown } from "@valentinkolb/cloud/lib/shared";
import { Dropdown } from "@valentinkolb/cloud/lib/ui";
import type { DropdownItem } from "@valentinkolb/cloud/lib/ui";
import { MarkdownView } from "@valentinkolb/cloud/lib/ui";
import { EntitySearch, type EntitySearchResult } from "@valentinkolb/cloud/lib/ui";
import { refreshCurrentPath } from "../../../lib/navigation";
import CommentsSection from "./CommentsSection";
import type { SpaceItem, SpaceColumn, SpaceTag, SpaceItemAssignee, SpaceComment } from "@/spaces/contracts";

type Props = {
  item: SpaceItem;
  columns: SpaceColumn[];
  tags: SpaceTag[];
  spaceId: string;
  /** Base URL for close link */
  baseUrl: string;
  /** Current user ID for comment editing */
  currentUserId: string;
  /** Initial comments list */
  initialComments?: SpaceComment[];
};

// =============================================================================
// Constants
// =============================================================================

const PRIORITY_OPTIONS = [
  {
    value: "urgent",
    label: "Urgent",
    icon: "ti ti-alert-circle",
    color: "#ef4444",
  },
  { value: "high", label: "High", icon: "ti ti-arrow-up", color: "#f97316" },
  { value: "medium", label: "Medium", icon: "ti ti-minus", color: "#eab308" },
  { value: "low", label: "Low", icon: "ti ti-arrow-down", color: "#3b82f6" },
] as const;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const isNullableString = (value: unknown): value is string | null => typeof value === "string" || value === null;

const isSpaceComment = (value: unknown): value is SpaceComment => {
  if (!isObject(value)) return false;
  return (
    typeof value["id"] === "string" &&
    typeof value["itemId"] === "string" &&
    typeof value["content"] === "string" &&
    isNullableString(value["userId"]) &&
    isNullableString(value["userName"]) &&
    typeof value["createdAt"] === "string" &&
    typeof value["updatedAt"] === "string"
  );
};

const isSpaceCommentArray = (value: unknown): value is SpaceComment[] => Array.isArray(value) && value.every(isSpaceComment);

// =============================================================================
// Helper Components
// =============================================================================

/** Inline editable field with dropdown */
function EditableDropdown(props: {
  label: string;
  icon: string;
  value: string | null;
  options: Array<{
    value: string;
    label: string;
    icon?: string;
    color?: string;
  }>;
  onChange: (value: string | null) => void;
  loading?: boolean;
  allowClear?: boolean;
}) {
  const selectedOption = () => props.options.find((o) => o.value === props.value);

  const dropdownElements = (): DropdownItem[] => {
    const items: DropdownItem[] = props.options.map((option) => ({
      element: (
        <button
          type="button"
          class="flex w-full items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-white/30 dark:hover:bg-white/10"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            props.onChange(option.value);
          }}
        >
          <Show when={option.color}>
            <div class="w-3 h-3 rounded-full shrink-0" style={`background-color: ${option.color}`} />
          </Show>
          <Show when={option.icon && !option.color}>
            <i class={`${option.icon} ${props.value === option.value ? "text-blue-500" : "text-zinc-400"}`} />
          </Show>
          <span class="flex-1 truncate text-left">{option.label}</span>
          <Show when={props.value === option.value}>
            <i class="ti ti-check text-blue-500" />
          </Show>
        </button>
      ),
    }));

    if (props.allowClear && props.value) {
      items.push({
        items: [
          {
            icon: "ti ti-x",
            label: "Clear",
            variant: "danger" as const,
            action: () => props.onChange(null),
          },
        ],
      });
    }

    return items;
  };

  const trigger = (
    <div class="inline-flex items-center gap-2 btn-sm rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors">
      <Show when={props.loading}>
        <i class="ti ti-loader-2 animate-spin text-zinc-400" />
      </Show>
      <Show when={!props.loading}>
        <Show when={selectedOption()?.color}>
          <div class="w-3 h-3 rounded-full" style={`background-color: ${selectedOption()!.color}`} />
        </Show>
        <Show when={selectedOption()?.icon && !selectedOption()?.color}>
          <i class={`${selectedOption()!.icon}`} style={selectedOption()?.color ? `color: ${selectedOption()!.color}` : ""} />
        </Show>
        <Show when={!selectedOption()}>
          <i class={`${props.icon} text-zinc-400`} />
        </Show>
      </Show>
      <span class={selectedOption() ? "" : "text-dimmed"}>{selectedOption()?.label ?? `No ${props.label}`}</span>
      <i class="ti ti-chevron-down text-zinc-400 text-xs" />
    </div>
  );

  return (
    <div>
      <h3 class="section-label mb-1">{props.label}</h3>
      <Dropdown trigger={trigger} elements={dropdownElements()} position="bottom-right" width="w-48" />
    </div>
  );
}

/** Multi-select tags dropdown */
function TagsDropdown(props: { tags: SpaceTag[]; selectedIds: string[]; onChange: (ids: string[]) => void; loading?: boolean }) {
  const [localSelection, setLocalSelection] = createSignal<string[]>([...props.selectedIds]);

  const selectedTags = () => props.tags.filter((t) => localSelection().includes(t.id));

  const toggleTag = (id: string) => {
    setLocalSelection((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  const handleClose = () => {
    // Only send IDs that exist in the current tags list (filters out stale/deleted tags)
    const validTagIds = new Set(props.tags.map((t) => t.id));
    const local = localSelection().filter((id) => validTagIds.has(id));
    const original = props.selectedIds;
    const hasChanges = local.length !== original.length || local.some((v) => !original.includes(v));
    if (hasChanges) {
      props.onChange(local);
    }
  };

  const dropdownElements = (): DropdownItem[] => {
    if (props.tags.length === 0) {
      return [
        {
          element: <div class="px-4 py-2 text-sm text-dimmed">No tags available</div>,
        },
      ];
    }

    const items: DropdownItem[] = props.tags.map((tag) => ({
      element: (
        <button
          type="button"
          class="flex w-full items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-white/30 dark:hover:bg-white/10"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleTag(tag.id);
          }}
        >
          <div
            class={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
              localSelection().includes(tag.id) ? "bg-blue-500 border-blue-500 text-white" : "border-zinc-300 dark:border-zinc-600"
            }`}
          >
            <Show when={localSelection().includes(tag.id)}>
              <i class="ti ti-check text-xs" />
            </Show>
          </div>
          <div class="w-3 h-3 rounded-full shrink-0" style={`background-color: ${tag.color}`} />
          <span class="flex-1 truncate text-left">{tag.name}</span>
        </button>
      ),
    }));

    if (localSelection().length > 0) {
      items.push({
        items: [
          {
            icon: "ti ti-x",
            label: "Clear all",
            variant: "danger" as const,
            action: () => setLocalSelection([]),
          },
        ],
      });
    }

    return items;
  };

  const trigger = (
    <div class="inline-flex items-center gap-2 btn-sm rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors">
      <Show when={props.loading}>
        <i class="ti ti-loader-2 animate-spin text-zinc-400" />
      </Show>
      <Show when={!props.loading}>
        <i class="ti ti-tags text-zinc-400" />
      </Show>
      <span class={selectedTags().length > 0 ? "" : "text-dimmed"}>
        {selectedTags().length > 0 ? `${selectedTags().length} Tags` : "No Tags"}
      </span>
      <i class="ti ti-chevron-down text-zinc-400 text-xs" />
    </div>
  );

  return (
    <div>
      <h3 class="text-xs font-medium text-dimmed uppercase tracking-wide mb-1.5">Tags</h3>
      <div class="flex flex-col gap-2">
        <Dropdown trigger={trigger} elements={dropdownElements()} position="bottom-right" width="w-52" onClose={handleClose} />
        <Show when={selectedTags().length > 0}>
          <div class="flex flex-wrap gap-1">
            <For each={selectedTags()}>
              {(tag) => (
                <span class="px-2 py-0.5 rounded text-xs" style={`background-color: ${tag.color}20; color: ${tag.color}`}>
                  {tag.name}
                </span>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}

/** Assignees section with add/remove functionality */
function AssigneesSection(props: { assignees: SpaceItemAssignee[]; onUpdate: (ids: string[]) => void; loading?: boolean }) {
  const currentIds = () => props.assignees.map((a) => a.id);

  const handleRemove = (id: string) => {
    props.onUpdate(currentIds().filter((i) => i !== id));
  };

  const handleAdd = async () => {
    const result = await prompts.dialog<EntitySearchResult | null>(
      (close) => (
        <div class="min-h-70">
          <EntitySearch
            searchUsers
            searchGroups={false}
            excludeUserIds={currentIds()}
            onSelect={(result) => close(result)}
            placeholder="Search users..."
          />
        </div>
      ),
      { title: "Add Assignee", icon: "ti ti-user-plus" },
    );

    if (result?.type === "user") {
      props.onUpdate([...currentIds(), result.id]);
    }
  };

  return (
    <div>
      <h3 class="text-xs font-medium text-dimmed uppercase tracking-wide mb-1.5">Assignees</h3>
      <div class="flex flex-col gap-2">
        {/* Current assignees list */}
        <Show when={props.assignees.length > 0}>
          <div class="flex flex-col gap-1">
            <For each={props.assignees}>
              {(assignee) => (
                <div class="flex items-center gap-2 group">
                  <div class="w-7 h-7 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-xs shrink-0">
                    {assignee.displayName.charAt(0).toUpperCase()}
                  </div>
                  <div class="flex-1 min-w-0">
                    <span class="text-sm truncate block">{assignee.displayName}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemove(assignee.id)}
                    disabled={props.loading}
                    class="p-1 text-zinc-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50"
                    aria-label={`Remove ${assignee.displayName}`}
                  >
                    <i class="ti ti-x text-sm" />
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* Empty state */}
        <Show when={props.assignees.length === 0}>
          <p class="text-xs text-dimmed">No assignees</p>
        </Show>

        {/* Add button */}
        <button
          type="button"
          onClick={handleAdd}
          disabled={props.loading}
          class="inline-flex items-center gap-1.5 btn-sm rounded-lg border border-dashed border-zinc-300 dark:border-zinc-600 text-dimmed hover:border-blue-400 hover:text-blue-500 transition-colors w-fit disabled:opacity-50"
        >
          <i class={props.loading ? "ti ti-loader-2 animate-spin" : "ti ti-plus"} />
          Add
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

/**
 * Item detail panel with inline editing.
 * All edits are saved immediately via API.
 */
export default function ItemDetailPanel(props: Props) {
  // Comments state
  const [comments, setComments] = createSignal<SpaceComment[]>(props.initialComments ?? []);

  const refreshComments = async () => {
    const res = await apiClient[":id"].items[":itemId"].comments.$get({
      param: { id: props.spaceId, itemId: props.item.id },
    });
    if (res.ok) {
      const data = await res.json();
      if (isSpaceCommentArray(data)) setComments(data);
    }
  };

  const updateMutation = mutations.create({
    mutation: async (data: Record<string, unknown>) => {
      const res = await apiClient[":id"].items[":itemId"].$patch({
        param: { id: props.spaceId, itemId: props.item.id },
        json: data,
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error("message" in data ? data.message : "Failed to update");
      }
      return res.json();
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (err) => prompts.error(err.message),
  });

  const completeMutation = mutations.create({
    mutation: async (completed: boolean) => {
      const res = await apiClient[":id"].items[":itemId"].completed.$post({
        param: { id: props.spaceId, itemId: props.item.id },
        json: { completed },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error("message" in data ? data.message : "Failed to update");
      }
      return res.json();
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (err) => prompts.error(err.message),
  });

  const handleDuplicate = async () => {
    const res = await apiClient[":id"].items.$post({
      param: { id: props.spaceId },
      json: {
        columnId: props.item.columnId,
        title: `${props.item.title} (Copy)`,
        description: props.item.description ?? undefined,
        startsAt: props.item.startsAt ?? undefined,
        endsAt: props.item.endsAt ?? undefined,
        deadline: props.item.deadline ?? undefined,
        priority: props.item.priority ?? undefined,
        assigneeIds: props.item.assignees?.map((a) => a.id),
        tagIds: props.item.tags?.map((t) => t.id),
      },
    });
    if (!res.ok) {
      const data = await res.json();
      prompts.error("message" in data ? data.message : "Failed to duplicate item");
      return;
    }
    refreshCurrentPath();
  };

  const handleDelete = async () => {
    const confirmed = await prompts.confirm(`Are you sure you want to delete "${props.item.title}"?`, {
      title: "Delete Item",
      icon: "ti ti-trash",
      variant: "danger",
      confirmText: "Delete",
    });
    if (!confirmed) return;

    const res = await apiClient[":id"].items[":itemId"].$delete({
      param: { id: props.spaceId, itemId: props.item.id },
    });
    if (!res.ok) {
      const data = await res.json();
      prompts.error("message" in data ? data.message : "Failed to delete item");
      return;
    }
    window.location.href = props.baseUrl;
  };

  const isLoading = () => updateMutation.loading() || completeMutation.loading();

  const isEvent = () => Boolean(props.item.startsAt && props.item.endsAt);
  const isCompleted = () => !!props.item.completedAt;
  const column = () => props.columns.find((c) => c.id === props.item.columnId);

  // Column options for status dropdown
  const columnOptions = () =>
    props.columns.map((c) => ({
      value: c.id,
      label: c.name,
      color: c.color || "#6b7280",
    }));

  // Priority options
  const priorityOptions = () =>
    PRIORITY_OPTIONS.map((p) => ({
      value: p.value,
      label: p.label,
      icon: `ti ${p.icon}`,
      color: p.color,
    }));

  // Edit title via prompt
  const editTitle = async () => {
    const result = await prompts.prompt("Edit title", props.item.title, {
      title: "Edit Title",
      icon: "ti ti-edit",
    });
    if (result && result !== props.item.title) {
      updateMutation.mutate({ title: result });
    }
  };

  // Edit description via prompt
  const editDescription = async () => {
    const result = await prompts.form({
      title: "Edit Description",
      icon: "ti ti-edit",
      fields: {
        description: {
          type: "text",
          multiline: true,
          default: props.item.description || "",
          label: false,
          placeholder: "Description in markdown ...",
        },
      },
    });
    if (result && result.description !== props.item.description) {
      updateMutation.mutate({ description: result.description || null });
    }
  };

  // Edit deadline via prompt
  const editDeadline = async () => {
    const result = await prompts.form({
      title: "Edit Deadline",
      icon: "ti ti-calendar-due",
      fields: {
        deadline: {
          type: "datetime",
          label: "Deadline",
          default: props.item.deadline ?? "",
        },
      },
    });
    if (result) {
      const deadline = result.deadline ? new Date(result.deadline).toISOString() : null;
      updateMutation.mutate({ deadline });
    }
  };

  // Edit event time via prompt
  const editEventTime = async () => {
    const result = await prompts.form({
      title: "Edit Event Time",
      icon: "ti ti-calendar-event",
      fields: {
        startsAt: {
          type: "datetime",
          label: "Start",
          default: props.item.startsAt ?? "",
          required: true,
        },
        endsAt: {
          type: "datetime",
          label: "End",
          default: props.item.endsAt ?? "",
          required: true,
        },
      },
    });
    if (result) {
      const startsAt = result.startsAt ? new Date(result.startsAt).toISOString() : null;
      const endsAt = result.endsAt ? new Date(result.endsAt).toISOString() : null;
      updateMutation.mutate({ startsAt, endsAt });
    }
  };

  return (
    <>
      <div class="p-4 flex flex-col gap-4" style="view-transition-name: detail-panel">
        {/* Header */}
        <div class="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={editTitle}
            class="font-semibold text-lg hover:text-blue-500 transition-colors text-left"
            disabled={isLoading()}
          >
            {props.item.title}
            <i class="ti ti-pencil text-xs ml-2 opacity-50" />
          </button>
          <a href={props.baseUrl} class="p-1 text-dimmed hover:text-primary shrink-0">
            <i class="ti ti-x" />
          </a>
        </div>

        {/* Completion Toggle */}
        <button
          type="button"
          onClick={() => completeMutation.mutate(!isCompleted())}
          disabled={isLoading()}
          class={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors w-full ${
            isCompleted()
              ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400"
              : "border-zinc-200 dark:border-zinc-700 hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/10"
          }`}
        >
          <div
            class={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors shrink-0 ${
              isCompleted() ? "border-emerald-500 bg-emerald-500 text-white" : "border-zinc-300 dark:border-zinc-600"
            }`}
          >
            <Show when={isCompleted() || completeMutation.loading()}>
              <i class={`ti ${completeMutation.loading() ? "ti-loader-2 animate-spin" : "ti-check"} text-xs`} />
            </Show>
          </div>
          <span class="text-sm font-medium">{isCompleted() ? "Completed" : "Mark as complete"}</span>
        </button>

        {/* Type badge + Actions */}
        <div class="flex items-center justify-between gap-2">
          <span
            class={`px-2 py-0.5 rounded text-xs font-medium ${
              isEvent()
                ? "bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400"
                : "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
            }`}
          >
            <i class={`ti ${isEvent() ? "ti-calendar-event" : "ti-checkbox"} mr-1`} />
            {isEvent() ? "Event" : "Task"}
          </span>

          <div class="flex items-center gap-1">
            {/* Duplicate */}
            <button
              type="button"
              onClick={handleDuplicate}
              disabled={isLoading()}
              class="p-1.5 text-dimmed hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors disabled:opacity-50"
              title="Duplicate"
            >
              <i class="ti ti-copy" />
            </button>

            {/* Delete */}
            <button
              type="button"
              onClick={handleDelete}
              disabled={isLoading()}
              class="p-1.5 text-dimmed hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors disabled:opacity-50"
              title="Delete"
            >
              <i class="ti ti-trash" />
            </button>
          </div>
        </div>

        {/* Deadline (Tasks) */}
        <Show when={!isEvent()}>
          <button
            type="button"
            onClick={editDeadline}
            disabled={isLoading()}
            class="group flex items-center gap-3 p-3 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors w-full text-left"
          >
            <div class="w-10 h-10 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center shrink-0">
              <i class="ti ti-calendar-due text-orange-500 text-lg" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-xs text-dimmed uppercase tracking-wide">Deadline</div>
              <Show when={props.item.deadline} fallback={<span class="text-sm text-dimmed italic">No deadline set</span>}>
                <span class="text-sm font-medium">{dates.formatDateTime(props.item.deadline!)}</span>
              </Show>
            </div>
          </button>
        </Show>

        {/* Event Time - Prominent, two lines */}
        <Show when={isEvent()}>
          <button
            type="button"
            onClick={editEventTime}
            disabled={isLoading()}
            class="group flex items-start gap-3 p-3 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors w-full text-left"
          >
            <div class="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center shrink-0">
              <i class="ti ti-calendar-event text-purple-500 text-lg" />
            </div>
            <div class="flex-1 min-w-0">
              <Show
                when={props.item.startsAt && props.item.endsAt}
                fallback={
                  <>
                    <div class="text-xs text-dimmed uppercase tracking-wide">Time</div>
                    <span class="text-sm text-dimmed italic">No time set</span>
                  </>
                }
              >
                <div class="flex flex-col gap-0.5">
                  <div class="flex items-center gap-2">
                    <span class="text-xs text-dimmed w-10">Start</span>
                    <span class="text-sm font-medium">{dates.formatDateTime(props.item.startsAt!)}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="text-xs text-dimmed w-10">End</span>
                    <span class="text-sm font-medium">{dates.formatDateTime(props.item.endsAt!)}</span>
                  </div>
                </div>
              </Show>
            </div>
          </button>
        </Show>

        {/* Description */}
        <div class="group/desc">
          <div class="flex items-center gap-1.5 mb-1.5">
            <h3 class="section-label mb-0">Description</h3>
          </div>
          <button
            type="button"
            onClick={editDescription}
            class="w-full text-left p-2 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors text-sm"
            disabled={isLoading()}
          >
            <Show when={props.item.description} fallback={<span class="text-xs text-dimmed">No description</span>}>
              <MarkdownView html={markdown.render(props.item.description!)} smallHeadings />
            </Show>
          </button>
        </div>

        {/* Status (Column) */}
        <EditableDropdown
          label="Kanban"
          icon="ti ti-layout-kanban"
          value={props.item.columnId}
          options={columnOptions()}
          onChange={(v) => v && updateMutation.mutate({ columnId: v })}
          loading={isLoading()}
        />

        {/* Priority */}
        <EditableDropdown
          label="Priority"
          icon="ti ti-flag"
          value={props.item.priority}
          options={priorityOptions()}
          onChange={(v) => updateMutation.mutate({ priority: v })}
          loading={isLoading()}
          allowClear
        />

        {/* Tags */}
        <TagsDropdown
          tags={props.tags}
          selectedIds={props.item.tags?.map((t) => t.id) ?? []}
          onChange={(ids) => updateMutation.mutate({ tagIds: ids })}
          loading={isLoading()}
        />

        {/* Assignees */}
        <AssigneesSection
          assignees={props.item.assignees ?? []}
          onUpdate={(ids) => updateMutation.mutate({ assigneeIds: ids })}
          loading={isLoading()}
        />
      </div>

      {/* Comments */}
      <div class="px-4 pb-4">
        <CommentsSection
          spaceId={props.spaceId}
          itemId={props.item.id}
          comments={comments()}
          currentUserId={props.currentUserId}
          onUpdate={refreshComments}
        />
      </div>
    </>
  );
}
