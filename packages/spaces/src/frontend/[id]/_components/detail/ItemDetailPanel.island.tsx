import { Show, For, createSignal } from "solid-js";
import { apiClient } from "@/api/client";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { dates } from "@valentinkolb/stdlib";
import { markdown } from "@valentinkolb/cloud/shared";
import { Dropdown, EntitySearch, MarkdownView, prompts, type DropdownItem, type EntitySearchResult } from "@valentinkolb/cloud/ui";
import { navigateTo, refreshCurrentPath } from "@valentinkolb/cloud/ui";
import { setDetailItemInUrl, shouldHandleDetailClick } from "../../../lib/detail";
import CommentsSection from "./CommentsSection";
import type { SpaceItem, SpaceTag, SpaceItemAssignee, SpaceComment } from "@/contracts";

type Props = {
  item: SpaceItem;
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

const PRIORITY_DROPDOWN_OPTIONS = PRIORITY_OPTIONS.map((priority) => ({
  value: priority.value,
  label: priority.label,
  icon: priority.icon,
  color: priority.color,
}));

const getPriorityMeta = (priority: SpaceItem["priority"]) => PRIORITY_OPTIONS.find((entry) => entry.value === priority) ?? null;

const DROPDOWN_TRIGGER_CLASS =
  "inline-flex items-center gap-2 btn-sm rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors";

const ICON_ACTION_BUTTON_CLASS =
  "inline-flex h-5 w-5 items-center justify-center text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 transition-colors disabled:opacity-50";

const DANGER_ICON_ACTION_BUTTON_CLASS =
  "inline-flex h-5 w-5 items-center justify-center text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 transition-colors disabled:opacity-50";

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
    typeof value["updatedAt"] === "string" &&
    typeof value["canDelete"] === "boolean"
  );
};

const isSpaceCommentArray = (value: unknown): value is SpaceComment[] => Array.isArray(value) && value.every(isSpaceComment);

const getResponseErrorMessage = async (res: Response, fallback: string) => {
  try {
    const data = (await res.json()) as unknown;
    if (isObject(data) && typeof data["message"] === "string" && data["message"].length > 0) {
      return data["message"];
    }
  } catch {}
  return fallback;
};

// =============================================================================
// Helper Components
// =============================================================================

function IconActionButton(props: {
  icon: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      class={props.danger ? DANGER_ICON_ACTION_BUTTON_CLASS : ICON_ACTION_BUTTON_CLASS}
      title={props.title}
      aria-label={props.title}
    >
      <i class={props.icon} />
    </button>
  );
}

function SectionHeader(props: { title: string; onEdit?: () => void; editLabel?: string; disabled?: boolean }) {
  return (
    <div class="mb-3 flex items-center justify-between gap-2">
      <h3 class="detail-section-label">{props.title}</h3>
      <Show when={props.onEdit}>
        <IconActionButton
          icon="ti ti-pencil"
          title={props.editLabel ?? `Edit ${props.title.toLowerCase()}`}
          onClick={() => props.onEdit?.()}
          disabled={props.disabled}
        />
      </Show>
    </div>
  );
}

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
    <div class={DROPDOWN_TRIGGER_CLASS}>
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
    <div class={DROPDOWN_TRIGGER_CLASS}>
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

  return <Dropdown trigger={trigger} elements={dropdownElements()} position="bottom-right" width="w-52" onClose={handleClose} />;
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
            apiBaseUrl="/api/accounts"
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
    <div class="flex flex-col gap-2">
      {/* Current assignees list */}
      <Show when={props.assignees.length > 0}>
        <div class="flex flex-col gap-1">
          <For each={props.assignees}>
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
                  onClick={() => handleRemove(assignee.id)}
                  disabled={props.loading}
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

      <button
        type="button"
        onClick={handleAdd}
        disabled={props.loading}
        class="btn-simple btn-sm w-fit text-xs text-dimmed hover:text-primary disabled:opacity-50"
      >
        <i class={props.loading ? "ti ti-loader-2 animate-spin" : "ti ti-plus"} />
        Add assignee
      </button>
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
        throw new Error(await getResponseErrorMessage(res, "Failed to update"));
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
        throw new Error(await getResponseErrorMessage(res, "Failed to update"));
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
      prompts.error(await getResponseErrorMessage(res, "Failed to duplicate item"));
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
      prompts.error(await getResponseErrorMessage(res, "Failed to delete item"));
      return;
    }
    navigateTo(props.baseUrl);
  };

  const isLoading = () => updateMutation.loading() || completeMutation.loading();

  const isEvent = () => Boolean(props.item.startsAt && props.item.endsAt);
  const isCompleted = () => !!props.item.completedAt;

  const editTitle = async () => {
    const result = await prompts.form({
      title: "Edit Title",
      icon: "ti ti-edit",
      size: "small",
      fields: {
        title: {
          type: "text",
          label: false,
          default: props.item.title,
          required: true,
          maxLength: 200,
        },
      },
    });
    if (result && result.title !== props.item.title) {
      updateMutation.mutate({ title: result.title });
    }
  };

  const editDescription = async () => {
    const result = await prompts.form({
      title: "Edit Description",
      icon: "ti ti-file-text",
      size: "large",
      fields: {
        description: {
          type: "text",
          label: false,
          multiline: true,
          lines: 12,
          default: props.item.description || "",
          placeholder: "Write a description…",
          maxLength: 5000,
        },
        cheatsheet: {
          type: "info",
          content: () => (
            <div class="text-[11px] leading-relaxed text-dimmed">
              <span class="font-medium">Markdown:</span>{" "}
              <code class="font-mono">**bold**</code>
              {"  ·  "}
              <code class="font-mono">*italic*</code>
              {"  ·  "}
              <code class="font-mono"># heading</code>
              {"  ·  "}
              <code class="font-mono">- list</code>
              {"  ·  "}
              <code class="font-mono">[text](url)</code>
              {"  ·  "}
              <code class="font-mono">`code`</code>
            </div>
          ),
        },
      },
    });
    if (result && result.description !== (props.item.description || "")) {
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

  const scheduleTitle = () => (isEvent() ? "Event Time" : "Deadline");

  return (
    <div class="flex flex-col" style="view-transition-name: detail-panel">
      <section class="detail-section" style="view-transition-name: space-item-detail-header">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="flex items-start gap-2">
              <h2 class="min-w-0 flex-1 break-words text-lg font-semibold leading-tight text-primary">{props.item.title}</h2>
              <IconActionButton icon="ti ti-pencil" title="Edit title" onClick={editTitle} disabled={isLoading()} />
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span
                class={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-medium ${
                  isEvent()
                    ? "bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300"
                    : "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300"
                }`}
              >
                <i class={`ti ${isEvent() ? "ti-calendar-event" : "ti-checkbox"}`} />
                {isEvent() ? "Event" : "Task"}
              </span>
              <span
                class={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-medium ${
                  isCompleted()
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                    : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                }`}
              >
                <i class={`ti ${isCompleted() ? "ti-circle-check" : "ti-circle"}`} />
                {isCompleted() ? "Completed" : "Active"}
              </span>
            </div>
          </div>
          <a
            href={props.baseUrl}
            onClick={(event) => {
              if (!shouldHandleDetailClick(event, event.currentTarget)) return;
              event.preventDefault();
              setDetailItemInUrl(null);
            }}
            class="inline-flex h-5 w-5 shrink-0 items-center justify-center text-orange-500 transition-colors hover:text-orange-600 dark:text-orange-400 dark:hover:text-orange-300"
            aria-label="Close detail"
          >
            <i class="ti ti-x" />
          </a>
        </div>

        <button
          type="button"
          onClick={() => completeMutation.mutate(!isCompleted())}
          disabled={isLoading()}
          class={`mt-4 flex w-full items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${
            isCompleted()
              ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
              : "border-zinc-200 hover:border-emerald-500 hover:bg-emerald-50 dark:border-zinc-700 dark:hover:bg-emerald-900/10"
          }`}
        >
          <div
            class={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors ${
              isCompleted() ? "border-emerald-500 bg-emerald-500 text-white" : "border-zinc-300 dark:border-zinc-600"
            }`}
          >
            <Show when={isCompleted() || completeMutation.loading()}>
              <i class={`ti ${completeMutation.loading() ? "ti-loader-2 animate-spin" : "ti-check"} text-xs`} />
            </Show>
          </div>
          <span class="text-sm font-medium">{isCompleted() ? "Completed" : "Mark as complete"}</span>
        </button>
      </section>

      <section class="detail-section">
        <SectionHeader
          title={scheduleTitle()}
          onEdit={isEvent() ? editEventTime : editDeadline}
          editLabel={isEvent() ? "Edit event time" : "Edit deadline"}
          disabled={isLoading()}
        />
        <Show
          when={isEvent()}
          fallback={
            <div class="flex items-baseline gap-3 text-xs text-primary">
              <i class="ti ti-calendar-due w-4 shrink-0 self-center text-center text-base text-amber-600 dark:text-amber-400" />
              <Show when={props.item.deadline} fallback={<span class="italic text-dimmed">No deadline set</span>}>
                <div class="min-w-0 flex-1">
                  <div>{dates.formatDateTime(props.item.deadline!)}</div>
                  <div class="mt-0.5 text-dimmed">{dates.formatTimeSpan(props.item.deadline!)}</div>
                </div>
              </Show>
            </div>
          }
        >
          <dl class="detail-facts">
            <dt class="detail-fact-key">Start</dt>
            <dd>
              <Show when={props.item.startsAt} fallback={<span class="italic text-dimmed">Not set</span>}>
                {dates.formatDateTime(props.item.startsAt!)}
              </Show>
            </dd>
            <dt class="detail-fact-key">End</dt>
            <dd>
              <Show when={props.item.endsAt} fallback={<span class="italic text-dimmed">Not set</span>}>
                {dates.formatDateTime(props.item.endsAt!)}
              </Show>
            </dd>
            <dt class="detail-fact-key">Duration</dt>
            <dd>
              <Show when={props.item.startsAt && props.item.endsAt} fallback={<span class="italic text-dimmed">Not set</span>}>
                {dates.formatDuration(props.item.startsAt!, props.item.endsAt!)}
              </Show>
            </dd>
          </dl>
        </Show>
      </section>

      <section class="detail-section" style="view-transition-name: space-item-detail-description">
        <SectionHeader title="Description" onEdit={editDescription} disabled={isLoading()} />
        <Show when={props.item.description} fallback={<p class="text-xs text-dimmed">No description</p>}>
          <MarkdownView html={markdown.render(props.item.description!)} smallHeadings class="text-sm" />
        </Show>
      </section>

      <section class="detail-section">
        <h3 class="detail-section-label">Classify</h3>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <EditableDropdown
            label="Priority"
            icon="ti ti-flag"
            value={props.item.priority}
            options={PRIORITY_DROPDOWN_OPTIONS}
            onChange={(v) => updateMutation.mutate({ priority: v })}
            loading={isLoading()}
            allowClear
          />
          <div>
            <h3 class="section-label mb-1">Tags</h3>
            <TagsDropdown
              tags={props.tags}
              selectedIds={props.item.tags?.map((t) => t.id) ?? []}
              onChange={(ids) => updateMutation.mutate({ tagIds: ids })}
              loading={isLoading()}
            />
          </div>
        </div>
      </section>

      <section class="detail-section">
        <h3 class="detail-section-label">Assignees</h3>
        <AssigneesSection
          assignees={props.item.assignees ?? []}
          onUpdate={(ids) => updateMutation.mutate({ assigneeIds: ids })}
          loading={isLoading()}
        />
      </section>

      <section class="detail-section">
        <h3 class="detail-section-label">Meta</h3>
        <dl class="detail-facts">
          <dt class="detail-fact-key">Created</dt>
          <dd>{dates.formatDateTime(props.item.createdAt)}</dd>
          <dt class="detail-fact-key">Updated</dt>
          <dd>{dates.formatDateTime(props.item.updatedAt)}</dd>
          <dt class="detail-fact-key">ID</dt>
          <dd class="break-all font-mono text-dimmed">{props.item.id}</dd>
        </dl>
        <div class="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={handleDuplicate}
            disabled={isLoading()}
            class="btn-simple btn-sm text-xs text-dimmed hover:text-primary"
          >
            <i class="ti ti-copy" /> Duplicate
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isLoading()}
            class="btn-simple btn-sm text-xs text-dimmed hover:text-red-600 dark:hover:text-red-400"
          >
            <i class="ti ti-trash" /> Delete
          </button>
        </div>
      </section>

      <section class="detail-section" style="view-transition-name: space-item-detail-comments">
        <CommentsSection
          spaceId={props.spaceId}
          itemId={props.item.id}
          comments={comments()}
          currentUserId={props.currentUserId}
          onUpdate={refreshComments}
        />
      </section>
    </div>
  );
}
