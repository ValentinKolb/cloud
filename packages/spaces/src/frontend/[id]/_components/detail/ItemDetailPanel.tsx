import { markdown } from "@valentinkolb/cloud/shared";
import { Dropdown, type DropdownItem, MarkdownView, prompts, toast } from "@valentinkolb/cloud/ui";
import { type DateContext, dates } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createSignal, onCleanup, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { SpaceColumn, SpaceComment, SpaceItem, SpaceItemAssignee, SpaceTag } from "@/contracts";
import { shouldHandleDetailClick } from "../../../lib/detail";
import { editItemWithDialog, handleEditItemSuccess } from "../shared/editItem";
import { summarizeRecurrence } from "../shared/recurrence";
import SpaceAssigneePicker from "../shared/SpaceAssigneePicker";
import { requestCurrentSpacesRouteRefresh, requestSpacesRouteNavigation } from "../workspace/workspace-events";
import CommentsSection from "./CommentsSection";

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
  dateConfig?: DateContext;
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

const DROPDOWN_TRIGGER_CLASS = "btn-input btn-input-sm w-full gap-2";

const ICON_ACTION_BUTTON_CLASS = "icon-btn h-7 w-7";

const DANGER_ICON_ACTION_BUTTON_CLASS = "icon-btn h-7 w-7 hover:text-red-600 dark:hover:text-red-400";

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
    isNullableString(value["userAvatarHash"]) &&
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

function IconActionButton(props: { icon: string; title: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
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
      <h3 class="detail-section-label mb-0">{props.title}</h3>
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
          class="flex w-full items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-[var(--ui-menu-hover)]"
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
            <i class={`${option.icon} ${props.value === option.value ? "text-primary" : "text-dimmed"}`} />
          </Show>
          <span class="flex-1 truncate text-left">{option.label}</span>
          <Show when={props.value === option.value}>
            <i class="ti ti-check text-primary" />
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
        <i class="ti ti-loader-2 animate-spin text-dimmed" />
      </Show>
      <Show when={!props.loading}>
        <Show when={selectedOption()?.color}>
          <div class="w-3 h-3 rounded-full" style={`background-color: ${selectedOption()!.color}`} />
        </Show>
        <Show when={selectedOption()?.icon && !selectedOption()?.color}>
          <i class={`${selectedOption()!.icon}`} style={selectedOption()?.color ? `color: ${selectedOption()!.color}` : ""} />
        </Show>
        <Show when={!selectedOption()}>
          <i class={`${props.icon} text-dimmed`} />
        </Show>
      </Show>
      <span class={`flex-1 truncate text-left ${selectedOption() ? "" : "text-dimmed"}`}>
        {selectedOption()?.label ?? `No ${props.label}`}
      </span>
      <i class="ti ti-chevron-down shrink-0 text-xs text-dimmed" />
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
          class="flex w-full items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-[var(--ui-menu-hover)]"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleTag(tag.id);
          }}
        >
          <div
            class={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
              localSelection().includes(tag.id)
                ? "border-[var(--ui-action-primary-border)] bg-[var(--ui-action-primary-surface)] text-[var(--ui-action-primary-text)]"
                : "border-[var(--ui-field-border)] bg-[var(--ui-field)]"
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
        <i class="ti ti-loader-2 animate-spin text-dimmed" />
      </Show>
      <Show when={!props.loading}>
        <i class="ti ti-tags text-dimmed" />
      </Show>
      <span class={`flex-1 truncate text-left ${selectedTags().length > 0 ? "" : "text-dimmed"}`}>
        {selectedTags().length > 0 ? `${selectedTags().length} Tags` : "No Tags"}
      </span>
      <i class="ti ti-chevron-down shrink-0 text-xs text-dimmed" />
    </div>
  );

  return <Dropdown trigger={trigger} elements={dropdownElements()} position="bottom-right" width="w-52" onClose={handleClose} />;
}

/** Assignees section with add/remove functionality */
function AssigneesSection(props: {
  spaceId: string;
  assignees: SpaceItemAssignee[];
  onUpdate: (ids: string[]) => void;
  loading?: boolean;
}) {
  return (
    <SpaceAssigneePicker
      spaceId={props.spaceId}
      value={() => props.assignees}
      onChange={(next) => props.onUpdate(next.map((assignee) => assignee.id))}
      disabled={props.loading}
      variant="rows"
      placeholder="Search people with access..."
    />
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

  const patchItem = async (data: Record<string, unknown>) => {
    const res = await apiClient[":id"].items[":itemId"].$patch({
      param: { id: props.spaceId, itemId: props.item.id },
      json: data,
    });
    if (!res.ok) {
      throw new Error(await getResponseErrorMessage(res, "Failed to update"));
    }
    return (await res.json()) as SpaceItem;
  };

  const handleItemUpdated = (item: SpaceItem | null) => {
    if (!item) return;
    toast.success("Item updated");
    requestCurrentSpacesRouteRefresh();
  };

  const refreshCommentsMutation = mutations.create<SpaceComment[], void>({
    mutation: async (_vars, ctx) => {
      const res = await apiClient[":id"].items[":itemId"].comments.$get(
        {
          param: { id: props.spaceId, itemId: props.item.id },
        },
        { init: { signal: ctx.abortSignal } },
      );
      if (!res.ok) {
        throw new Error(await getResponseErrorMessage(res, "Failed to refresh comments"));
      }
      const data = await res.json();
      return isSpaceCommentArray(data) ? data : [];
    },
    onSuccess: setComments,
    onError: (err) => {
      if (err.name === "AbortError") return;
      prompts.error(err.message);
    },
  });

  const refreshComments = () => {
    refreshCommentsMutation.abort();
    void refreshCommentsMutation.mutate(undefined);
  };

  onCleanup(() => refreshCommentsMutation.abort());

  const updateMutation = mutations.create<SpaceItem, Record<string, unknown>>({
    mutation: patchItem,
    onSuccess: handleItemUpdated,
    onError: (err) => prompts.error(err.message),
  });

  const completeMutation = mutations.create<boolean, boolean>({
    mutation: async (completed: boolean) => {
      const res = await apiClient[":id"].items[":itemId"].completed.$post({
        param: { id: props.spaceId, itemId: props.item.id },
        json: { completed },
      });
      if (!res.ok) {
        throw new Error(await getResponseErrorMessage(res, "Failed to update"));
      }
      await res.json();
      return completed;
    },
    onSuccess: (completed) => {
      toast.success(completed ? "Item completed" : "Item reopened");
      requestCurrentSpacesRouteRefresh();
    },
    onError: (err) => prompts.error(err.message),
  });

  const duplicateMutation = mutations.create<SpaceItem, void>({
    mutation: async () => {
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
      if (!res.ok) throw new Error(await getResponseErrorMessage(res, "Failed to duplicate item"));
      return res.json();
    },
    onSuccess: () => {
      toast.success("Item duplicated");
      requestCurrentSpacesRouteRefresh();
    },
    onError: (err) => prompts.error(err.message),
  });

  const deleteMutation = mutations.create({
    mutation: async () => {
      const confirmed = await prompts.confirm(`Are you sure you want to delete "${props.item.title}"?`, {
        title: "Delete Item",
        icon: "ti ti-trash",
        variant: "danger",
        confirmText: "Delete",
      });
      if (!confirmed) return false;

      const res = await apiClient[":id"].items[":itemId"].$delete({
        param: { id: props.spaceId, itemId: props.item.id },
      });
      if (!res.ok) throw new Error(await getResponseErrorMessage(res, "Failed to delete item"));
      return true;
    },
    onSuccess: (deleted) => {
      if (!deleted) return;
      toast.success("Item deleted");
      requestSpacesRouteNavigation(props.baseUrl, { scroll: "preserve" });
    },
    onError: (err) => prompts.error(err.message),
  });

  const handleDuplicate = () => duplicateMutation.mutate(undefined);
  const handleDelete = () => deleteMutation.mutate({});

  const editItemMutation = mutations.create<boolean, void>({
    mutation: () =>
      editItemWithDialog({
        spaceId: props.spaceId,
        item: props.item,
        columns: props.columns,
        tags: props.tags,
        dateConfig: props.dateConfig,
      }),
    onSuccess: handleEditItemSuccess,
    onError: (err) => prompts.error(err.message),
  });

  const isLoading = () =>
    updateMutation.loading() ||
    completeMutation.loading() ||
    duplicateMutation.loading() ||
    deleteMutation.loading() ||
    editItemMutation.loading();

  const isEvent = () => Boolean(props.item.startsAt && props.item.endsAt);
  const isCompleted = () => !!props.item.completedAt;
  const recurrenceSummary = () => summarizeRecurrence(props.item.recurrence);

  const scheduleTitle = () => (isEvent() ? "Event Time" : "Deadline");

  return (
    <div class="flex h-full min-h-0 flex-col" style="view-transition-name: detail-panel">
      <header class="detail-header" style="view-transition-name: space-item-detail-header">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <h2 class="break-words text-lg font-semibold leading-tight text-primary">{props.item.title}</h2>
            <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span class="inline-flex items-center gap-1 rounded-md bg-[var(--ui-surface-subtle)] px-2 py-0.5 font-medium text-secondary">
                <i class={`ti ${isEvent() ? "ti-calendar-event" : "ti-checkbox"}`} />
                {isEvent() ? "Event" : "Task"}
              </span>
              <span
                class={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-medium ${
                  isCompleted()
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "bg-[var(--ui-surface-subtle)] text-secondary"
                }`}
              >
                <i class={`ti ${isCompleted() ? "ti-circle-check" : "ti-circle"}`} />
                {isCompleted() ? "Completed" : "Active"}
              </span>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <Dropdown
              trigger={
                <button type="button" class="icon-btn" aria-label="More item actions">
                  <i class="ti ti-dots" />
                </button>
              }
              elements={[
                {
                  label: "Duplicate item",
                  icon: "ti ti-copy",
                  action: handleDuplicate,
                },
                {
                  items: [
                    {
                      label: "Delete item",
                      icon: "ti ti-trash",
                      variant: "danger",
                      action: handleDelete,
                    },
                  ],
                },
              ]}
              position="bottom-left"
            />
            <a
              href={props.baseUrl}
              onClick={(event) => {
                if (!shouldHandleDetailClick(event, event.currentTarget)) return;
                event.preventDefault();
                requestSpacesRouteNavigation(props.baseUrl, { scroll: "preserve" });
              }}
              class="icon-btn"
              aria-label="Close detail"
            >
              <i class="ti ti-x" />
            </a>
          </div>
        </div>

        <div class="mt-3 mb-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => completeMutation.mutate(!isCompleted())}
            disabled={isLoading()}
            class={`btn-secondary btn-sm ${isCompleted() ? "text-emerald-700 dark:text-emerald-300" : ""}`}
          >
            <Show when={isCompleted() || completeMutation.loading()}>
              <i class={`ti ${completeMutation.loading() ? "ti-loader-2 animate-spin" : "ti-check"}`} />
            </Show>
            <Show when={!isCompleted() && !completeMutation.loading()}>
              <i class="ti ti-circle-check" />
            </Show>
            {isCompleted() ? "Reopen" : "Mark complete"}
          </button>
          <button type="button" class="btn-secondary btn-sm" onClick={() => editItemMutation.mutate(undefined)} disabled={isLoading()}>
            <i class="ti ti-pencil" /> Edit
          </button>
        </div>
      </header>

      <div class="detail-stack">
        <Show when={isEvent() || props.item.deadline}>
          <section class="detail-section">
            <SectionHeader
              title={scheduleTitle()}
              onEdit={() => editItemMutation.mutate(undefined)}
              editLabel={isEvent() ? "Edit event time" : "Edit deadline"}
              disabled={isLoading()}
            />
            <Show
              when={isEvent()}
              fallback={
                <div class="flex items-baseline gap-3 text-xs text-primary">
                  <i class="ti ti-calendar-due w-4 shrink-0 self-center text-center text-base text-amber-600 dark:text-amber-400" />
                  <Show when={props.item.deadline}>
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
                <dd>{dates.formatDateTime(props.item.startsAt!)}</dd>
                <dt class="detail-fact-key">End</dt>
                <dd>{dates.formatDateTime(props.item.endsAt!)}</dd>
                <dt class="detail-fact-key">Duration</dt>
                <dd>{dates.formatDuration(props.item.startsAt!, props.item.endsAt!)}</dd>
                <Show when={recurrenceSummary()}>
                  <dt class="detail-fact-key">Repeat</dt>
                  <dd>
                    <span class="inline-flex items-center gap-1 text-xs font-medium text-secondary">
                      <i class="ti ti-repeat text-dimmed" />
                      {recurrenceSummary()}
                    </span>
                  </dd>
                </Show>
              </dl>
            </Show>
          </section>
        </Show>

        <Show when={isEvent() && (props.item.location || props.item.url)}>
          <section class="detail-section">
            <SectionHeader title="Event details" onEdit={() => editItemMutation.mutate(undefined)} disabled={isLoading()} />
            <dl class="detail-facts">
              <Show when={props.item.location}>
                <dt class="detail-fact-key">Location</dt>
                <dd>{props.item.location}</dd>
              </Show>
              <Show when={props.item.url}>
                <dt class="detail-fact-key">URL</dt>
                <dd>
                  <a href={props.item.url!} target="_blank" rel="noreferrer" class="link break-all">
                    {props.item.url}
                  </a>
                </dd>
              </Show>
            </dl>
          </section>
        </Show>

        <Show when={props.item.description}>
          <section class="detail-section" style="view-transition-name: space-item-detail-description">
            <SectionHeader title="Description" onEdit={() => editItemMutation.mutate(undefined)} disabled={isLoading()} />
            <MarkdownView html={markdown.render(props.item.description!)} smallHeadings class="text-sm" />
          </section>
        </Show>

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
            spaceId={props.spaceId}
            assignees={props.item.assignees ?? []}
            onUpdate={(ids) => updateMutation.mutate({ assigneeIds: ids })}
            loading={isLoading()}
          />
        </section>

        <section class="detail-section" style="view-transition-name: space-item-detail-comments">
          <CommentsSection
            spaceId={props.spaceId}
            itemId={props.item.id}
            comments={comments()}
            currentUserId={props.currentUserId}
            onUpdate={refreshComments}
            dateConfig={props.dateConfig}
          />
        </section>

        <details class="detail-section group/details">
          <summary class="focus-ui flex cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--ui-radius-control)] text-sm font-medium text-primary">
            <span class="inline-flex items-center gap-2">
              <i class="ti ti-info-circle text-dimmed" /> Item information
            </span>
            <i class="ti ti-chevron-down text-xs text-dimmed transition-transform group-open/details:rotate-180" />
          </summary>
          <dl class="detail-facts mt-3">
            <dt class="detail-fact-key">Created</dt>
            <dd>{dates.formatDateTime(props.item.createdAt)}</dd>
            <dt class="detail-fact-key">Updated</dt>
            <dd>{dates.formatDateTime(props.item.updatedAt)}</dd>
            <dt class="detail-fact-key">ID</dt>
            <dd class="break-all font-mono text-dimmed">{props.item.id}</dd>
          </dl>
        </details>
      </div>
    </div>
  );
}
