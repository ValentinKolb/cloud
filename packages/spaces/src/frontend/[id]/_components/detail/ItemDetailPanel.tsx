import { type DateContext, dates } from "@k2b/stdlib";
import { mutation as mutations } from "@k2b/stdlib/solid";
import {
  Button,
  ButtonLink,
  DescriptionList,
  DetailPanel,
  Dropdown,
  type DropdownItem,
  IconButton,
  MarkdownView,
  MultiSelectInput,
  prompts,
  Select,
  Tag,
  Tooltip,
  toast,
} from "@k2b/ui";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { SpaceColumn, SpaceItem, SpaceItemAssignee, SpaceTag, SpaceWormhole, WormholeTransferResult } from "@/contracts";
import { shouldHandleDetailClick } from "../../../lib/detail";
import { readResponseError } from "../../../lib/response";
import { editItemWithDialog, handleEditItemSuccess } from "../shared/editItem";
import { summarizeRecurrence } from "../shared/recurrence";
import SpaceAssigneePicker from "../shared/SpaceAssigneePicker";
import { requestCurrentSpacesRouteRefresh, requestSpacesRouteNavigation } from "../workspace/workspace-events";
import type { SpaceItemDetail } from "../workspace/workspace-types";
import { canTransferThroughWormhole, showWormholeTransferToast, transferThroughWormhole } from "../wormhole-transfer";
import CommentsSection from "./CommentsSection";
import EventInvitations from "./EventInvitations";

type Props = {
  item: SpaceItem;
  columns: SpaceColumn[];
  tags: SpaceTag[];
  wormholes: SpaceWormhole[];
  spaceId: string;
  /** Base URL for close link */
  baseUrl: string;
  /** Current user ID for comment editing */
  currentUserId: string;
  /** Newest bounded comments page rendered with the detail snapshot. */
  initialCommentsPage: SpaceItemDetail["comments"];
  commentTarget: SpaceItemDetail["commentTarget"];
  recurringContext: SpaceItemDetail["recurringContext"];
  dateConfig?: DateContext;
  canWrite: boolean;
  mailIntegrationAvailable: boolean;
  scrollPreserveKey: string;
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

// =============================================================================
// Helper Components
// =============================================================================

function IconActionButton(props: { icon: string; title: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <Tooltip.Anchor content={props.title}>
      <IconButton
        label={props.title}
        size="sm"
        onClick={props.onClick}
        disabled={props.disabled}
        class={`h-7 w-7 ${props.danger ? "hover:text-red-600 dark:hover:text-red-400" : ""}`}
      >
        <i class={props.icon} aria-hidden="true" />
      </IconButton>
    </Tooltip.Anchor>
  );
}

/** Assignees section with add/remove functionality */
function AssigneesSection(props: {
  spaceId: string;
  assignees: SpaceItemAssignee[];
  onUpdate: (ids: string[]) => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <SpaceAssigneePicker
      spaceId={props.spaceId}
      value={() => props.assignees}
      onChange={(next) => props.onUpdate(next.map((assignee) => assignee.id))}
      disabled={props.loading || props.disabled}
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
  const [commentsPage, setCommentsPage] = createSignal(props.initialCommentsPage);
  const [selectedPriorityValue, setSelectedPriorityValue] = createSignal<string | null>(props.item.priority);
  const [selectedTagIds, setSelectedTagIds] = createSignal(props.item.tags?.map((tag) => tag.id) ?? []);
  let selectedItemId = props.item.id;

  createEffect(() => {
    if (props.item.id === selectedItemId) return;
    selectedItemId = props.item.id;
    setSelectedPriorityValue(props.item.priority);
    setSelectedTagIds(props.item.tags?.map((tag) => tag.id) ?? []);
  });
  const isGeneratedOccurrence = () => Boolean(props.recurringContext && !props.recurringContext.isOverride);
  const canEditItem = () => props.canWrite && !isGeneratedOccurrence();
  const scheduleStart = () => props.recurringContext?.startsAt ?? props.item.startsAt;
  const scheduleEnd = () => props.recurringContext?.endsAt ?? props.item.endsAt;
  const seriesHref = () => {
    if (!props.recurringContext) return props.baseUrl;
    const url = new URL(props.baseUrl, "http://spaces.local");
    url.searchParams.set("item", props.recurringContext.seriesItemId);
    url.searchParams.delete("occurrence");
    return `${url.pathname}?${url.searchParams.toString()}`;
  };

  const patchItem = async (data: Record<string, unknown>) => {
    const res = await apiClient[":id"].items[":itemId"].$patch({
      param: { id: props.spaceId, itemId: props.item.id },
      json: data,
    });
    if (!res.ok) {
      throw new Error(await readResponseError(res, "Failed to update"));
    }
    return (await res.json()) as SpaceItem;
  };

  const handleItemUpdated = (item: SpaceItem | null) => {
    if (!item) return;
    toast.success("Item updated");
    requestCurrentSpacesRouteRefresh();
  };

  const loadCommentsPage = async (page: number, signal: AbortSignal) => {
    const res = await apiClient[":id"].items[":itemId"].comments.page.$get(
      {
        param: { id: props.spaceId, itemId: props.commentTarget.itemId },
        query: {
          page: String(page),
          per_page: String(props.initialCommentsPage.perPage),
          ...(props.commentTarget.recurrenceId ? { recurrence_id: props.commentTarget.recurrenceId } : {}),
        },
      },
      { init: { signal } },
    );
    if (!res.ok) throw new Error(await readResponseError(res, "Failed to refresh comments"));
    return res.json();
  };

  const refreshCommentsMutation = mutations.create<SpaceItemDetail["comments"], void>({
    mutation: (_vars, ctx) => loadCommentsPage(1, ctx.abortSignal),
    onSuccess: setCommentsPage,
    onError: (err) => {
      if (err.name === "AbortError") return;
      prompts.error(err.message);
    },
  });

  const loadEarlierCommentsMutation = mutations.create<SpaceItemDetail["comments"], void>({
    mutation: (_vars, ctx) => loadCommentsPage(commentsPage().page + 1, ctx.abortSignal),
    onSuccess: (older) => {
      setCommentsPage((current) => ({
        ...older,
        items: [...older.items, ...current.items],
        total: Math.max(older.total, current.total),
      }));
    },
    onError: (err) => {
      if (err.name !== "AbortError") prompts.error(err.message);
    },
  });

  const refreshComments = () => {
    refreshCommentsMutation.abort();
    void refreshCommentsMutation.mutate(undefined);
  };

  onCleanup(() => {
    refreshCommentsMutation.abort();
    loadEarlierCommentsMutation.abort();
  });

  const updateMutation = mutations.create<SpaceItem, Record<string, unknown>>({
    mutation: patchItem,
    onSuccess: handleItemUpdated,
    onError: (err) => prompts.error(err.message),
  });

  let previousPriority = selectedPriorityValue();
  const priorityMutation = mutations.create<SpaceItem, string | null>({
    mutation: (priority) => patchItem({ priority }),
    onSuccess: handleItemUpdated,
    onError: (err) => {
      setSelectedPriorityValue(previousPriority);
      prompts.error(err.message);
    },
  });

  const updatePriority = (priority: string | null) => {
    if (priorityMutation.loading()) return;
    previousPriority = selectedPriorityValue();
    setSelectedPriorityValue(priority);
    priorityMutation.mutate(priority);
  };

  let previousTagIds = selectedTagIds();
  const tagsMutation = mutations.create<SpaceItem, string[]>({
    mutation: (tagIds) => patchItem({ tagIds }),
    onSuccess: handleItemUpdated,
    onError: (err) => {
      setSelectedTagIds(previousTagIds);
      prompts.error(err.message);
    },
  });

  const updateTags = (tagIds: string[]) => {
    if (tagsMutation.loading()) return;
    previousTagIds = selectedTagIds();
    setSelectedTagIds(tagIds);
    tagsMutation.mutate(tagIds);
  };

  const completeMutation = mutations.create<boolean, boolean>({
    mutation: async (completed: boolean) => {
      const res = await apiClient[":id"].items[":itemId"].completed.$post({
        param: { id: props.spaceId, itemId: props.item.id },
        json: { completed },
      });
      if (!res.ok) {
        throw new Error(await readResponseError(res, "Failed to update"));
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
      if (!res.ok) throw new Error(await readResponseError(res, "Failed to duplicate item"));
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
      if (!res.ok) throw new Error(await readResponseError(res, "Failed to delete item"));
      return true;
    },
    onSuccess: (deleted) => {
      if (!deleted) return;
      toast.success("Item deleted");
      requestSpacesRouteNavigation(props.baseUrl, { scroll: "preserve" });
    },
    onError: (err) => prompts.error(err.message),
  });

  const transferMutation = mutations.create<WormholeTransferResult, string>({
    mutation: (wormholeId, context) =>
      transferThroughWormhole({
        sourceSpaceId: props.spaceId,
        itemId: props.item.id,
        wormholeId,
        signal: context.abortSignal,
      }),
    onSuccess: (result) => {
      showWormholeTransferToast(result);
      requestSpacesRouteNavigation(props.baseUrl, { scroll: "preserve" });
    },
    onError: (error) => {
      if (error.name !== "AbortError") prompts.error(error.message);
    },
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
    priorityMutation.loading() ||
    tagsMutation.loading() ||
    completeMutation.loading() ||
    duplicateMutation.loading() ||
    deleteMutation.loading() ||
    transferMutation.loading() ||
    editItemMutation.loading();

  const isEvent = () => Boolean(props.item.startsAt && props.item.endsAt);
  const isCompleted = () => !!props.item.completedAt;
  const recurrenceSummary = () => summarizeRecurrence(props.item.recurrence);
  const itemActions = (): DropdownItem[] => {
    const actions: DropdownItem[] = [
      {
        label: "Edit item",
        icon: "ti ti-pencil",
        action: () => editItemMutation.mutate(undefined),
      },
      {
        label: "Duplicate item",
        icon: "ti ti-copy",
        action: handleDuplicate,
      },
    ];

    if (canTransferThroughWormhole(props.item) && props.wormholes.length > 0) {
      actions.push({
        items: props.wormholes.flatMap((wormhole) =>
          wormhole.target
            ? [
                {
                  label: `Move to ${wormhole.target.spaceName} / ${wormhole.target.columnName}`,
                  icon: "ti ti-arrow-bounce",
                  action: () => transferMutation.mutate(wormhole.id),
                },
              ]
            : [],
        ),
      });
    }

    actions.push({
      items: [
        {
          label: "Delete item",
          icon: "ti ti-trash",
          variant: "danger",
          action: handleDelete,
        },
      ],
    });
    return actions;
  };

  const scheduleTitle = () => (isEvent() ? "Event time" : "Deadline");
  const selectedPriority = () => PRIORITY_OPTIONS.find((option) => option.value === selectedPriorityValue());

  const canShowClassification = () => canEditItem() || Boolean(props.item.priority) || (props.item.tags?.length ?? 0) > 0;
  const canShowAssignees = () => canEditItem() || (props.item.assignees?.length ?? 0) > 0;
  const canShowInvitations = () => isEvent() && canEditItem() && props.mailIntegrationAvailable;
  const canShowEventContext = () => isEvent() && (Boolean(props.item.location || props.item.url) || canShowInvitations());

  return (
    <div class="h-full min-h-0" style="view-transition-name: detail-panel">
      <DetailPanel>
        <DetailPanel.Header
          class="[view-transition-name:space-item-detail-header]"
          icon={`ti ${isEvent() ? "ti-calendar-event" : "ti-checkbox"}`}
          title={props.item.title}
          subtitle={isEvent() ? "Event" : "Task"}
          meta={
            <>
              <span
                class={`inline-flex items-center gap-1.5 font-medium ${
                  isCompleted() ? "text-emerald-700 dark:text-emerald-300" : "text-lime-700 dark:text-lime-300"
                }`}
              >
                <span class={`h-1.5 w-1.5 rounded-full ${isCompleted() ? "bg-emerald-500" : "bg-lime-500"}`} aria-hidden="true" />
                {isCompleted() ? "Completed" : "Active"}
              </span>
              <Show when={!props.canWrite}>
                <span class="inline-flex items-center gap-1 text-dimmed">
                  <i class="ti ti-lock" aria-hidden="true" /> Read only
                </span>
              </Show>
              <Show when={props.recurringContext}>
                <span class="inline-flex items-center gap-1 text-secondary">
                  <i class="ti ti-repeat" aria-hidden="true" /> This occurrence
                </span>
              </Show>
            </>
          }
          actions={
            <>
              <Show when={canEditItem()}>
                <Dropdown.Root position="bottom-left" items={itemActions()}>
                  <Dropdown.Trigger iconOnly label="More item actions" tooltip="More item actions">
                    <i class="ti ti-dots" aria-hidden="true" />
                  </Dropdown.Trigger>
                </Dropdown.Root>
              </Show>
              <Tooltip.Anchor content="Close details">
                <ButtonLink
                  href={props.baseUrl}
                  onClick={(event) => {
                    if (!shouldHandleDetailClick(event, event.currentTarget)) return;
                    event.preventDefault();
                    requestSpacesRouteNavigation(props.baseUrl, { scroll: "preserve" });
                  }}
                  variant="ghost"
                  size="sm"
                  class="h-8 w-8 px-0"
                  aria-label="Close item details"
                >
                  <i class="ti ti-x" aria-hidden="true" />
                </ButtonLink>
              </Tooltip.Anchor>
            </>
          }
          primaryActions={
            props.canWrite || props.recurringContext ? (
              <>
                <Show when={canEditItem()}>
                  <Button
                    type="button"
                    onClick={() => completeMutation.mutate(!isCompleted())}
                    disabled={isLoading()}
                    variant={isCompleted() ? "secondary" : "success"}
                    size="sm"
                    class={isCompleted() ? "text-emerald-700 dark:text-emerald-300" : undefined}
                  >
                    <Show when={isCompleted() || completeMutation.loading()}>
                      <i class={`ti ${completeMutation.loading() ? "ti-loader-2 animate-spin" : "ti-check"}`} aria-hidden="true" />
                    </Show>
                    <Show when={!isCompleted() && !completeMutation.loading()}>
                      <i class="ti ti-circle-check" aria-hidden="true" />
                    </Show>
                    {isCompleted() ? "Reopen" : "Mark complete"}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => editItemMutation.mutate(undefined)} disabled={isLoading()}>
                    <i class="ti ti-pencil" aria-hidden="true" /> Edit
                  </Button>
                </Show>
                <Show when={props.recurringContext}>
                  <ButtonLink
                    href={seriesHref()}
                    variant="ghost"
                    size="sm"
                    onClick={(event) => {
                      if (!shouldHandleDetailClick(event, event.currentTarget)) return;
                      event.preventDefault();
                      requestSpacesRouteNavigation(seriesHref(), { scroll: "preserve" });
                    }}
                  >
                    <i class="ti ti-repeat" aria-hidden="true" /> View series
                  </ButtonLink>
                </Show>
              </>
            ) : undefined
          }
        />

        <DetailPanel.Body scrollPreserveKey={props.scrollPreserveKey}>
          <Show when={isEvent() || props.item.deadline}>
            <DetailPanel.Summary
              title={scheduleTitle()}
              actions={
                canEditItem() ? (
                  <IconActionButton
                    icon="ti ti-pencil"
                    title={isEvent() ? "Edit event time" : "Edit deadline"}
                    onClick={() => editItemMutation.mutate(undefined)}
                    disabled={isLoading()}
                  />
                ) : undefined
              }
            >
              <Show
                when={isEvent()}
                fallback={
                  <div class="flex items-baseline gap-3 text-xs text-primary">
                    <i
                      class="ti ti-calendar-due w-4 shrink-0 self-center text-center text-base text-amber-600 dark:text-amber-400"
                      aria-hidden="true"
                    />
                    <Show when={props.item.deadline}>
                      <div class="min-w-0 flex-1">
                        <div>{dates.formatDateTime(props.item.deadline!)}</div>
                        <div class="mt-0.5 text-dimmed">{dates.formatTimeSpan(props.item.deadline!)}</div>
                      </div>
                    </Show>
                  </div>
                }
              >
                <DescriptionList
                  layout="rows"
                  size="sm"
                  items={[
                    { term: "Start", description: dates.formatDateTime(scheduleStart()!) },
                    { term: "End", description: dates.formatDateTime(scheduleEnd()!) },
                    { term: "Duration", description: dates.formatDuration(scheduleStart()!, scheduleEnd()!) },
                    ...(recurrenceSummary()
                      ? [
                          {
                            term: "Repeat",
                            description: (
                              <span class="inline-flex items-center gap-1 font-medium text-secondary">
                                <i class="ti ti-repeat text-dimmed" aria-hidden="true" />
                                {recurrenceSummary()}
                              </span>
                            ),
                          },
                        ]
                      : []),
                  ]}
                />
              </Show>
            </DetailPanel.Summary>
          </Show>

          <Show when={canShowEventContext()}>
            <DetailPanel.Group label="Event context">
              <Show when={props.item.location || props.item.url}>
                <DetailPanel.Section
                  title="Event details"
                  icon="ti ti-map-pin"
                  tone="accent"
                  actions={
                    canEditItem() ? (
                      <IconActionButton
                        icon="ti ti-pencil"
                        title="Edit event details"
                        onClick={() => editItemMutation.mutate(undefined)}
                        disabled={isLoading()}
                      />
                    ) : undefined
                  }
                >
                  <DescriptionList
                    layout="rows"
                    size="sm"
                    items={[
                      ...(props.item.location ? [{ term: "Location", description: props.item.location }] : []),
                      ...(props.item.url
                        ? [
                            {
                              term: "URL",
                              description: (
                                <a href={props.item.url} target="_blank" rel="noreferrer" class="link break-all">
                                  {props.item.url}
                                </a>
                              ),
                            },
                          ]
                        : []),
                    ]}
                  />
                </DetailPanel.Section>
              </Show>
              <Show when={canShowInvitations()}>
                <EventInvitations spaceId={props.spaceId} itemId={props.item.id} />
              </Show>
            </DetailPanel.Group>
          </Show>

          <Show when={props.item.description}>
            <DetailPanel.Section
              class="[view-transition-name:space-item-detail-description]"
              title="Description"
              icon="ti ti-align-left"
              tone="neutral"
              actions={
                canEditItem() ? (
                  <IconActionButton
                    icon="ti ti-pencil"
                    title="Edit description"
                    onClick={() => editItemMutation.mutate(undefined)}
                    disabled={isLoading()}
                  />
                ) : undefined
              }
            >
              <MarkdownView markdown={props.item.description!} smallHeadings class="text-sm" />
            </DetailPanel.Section>
          </Show>

          <Show when={canShowClassification() || canShowAssignees()}>
            <DetailPanel.Group label="Organization">
              <Show when={canShowClassification()}>
                <DetailPanel.Section title="Classify" icon="ti ti-tags" tone="accent">
                  <div class="grid grid-cols-1 gap-3">
                    <Show
                      when={canEditItem()}
                      fallback={
                        <div>
                          <h4 class="section-label mb-1">Priority</h4>
                          <Show when={selectedPriority()} fallback={<span class="text-xs text-secondary">No priority</span>}>
                            {(priority) => (
                              <Tag color={priority().color} icon={priority().icon}>
                                {priority().label}
                              </Tag>
                            )}
                          </Show>
                        </div>
                      }
                    >
                      <Select
                        label="Priority"
                        placeholder="No priority"
                        icon="ti ti-flag"
                        value={selectedPriorityValue}
                        options={PRIORITY_OPTIONS.map((option) => ({ id: option.value, ...option }))}
                        onValueChange={updatePriority}
                        disabled={isLoading()}
                        clearable
                      />
                    </Show>
                    <Show
                      when={canEditItem()}
                      fallback={
                        <div>
                          <h4 class="section-label mb-1">Tags</h4>
                          <div class="flex min-h-8 flex-wrap items-center gap-1.5">
                            <Show when={(props.item.tags?.length ?? 0) > 0} fallback={<span class="text-xs text-secondary">No tags</span>}>
                              {props.item.tags?.map((tag) => (
                                <Tag color={tag.color} size="sm">
                                  {tag.name}
                                </Tag>
                              ))}
                            </Show>
                          </div>
                        </div>
                      }
                    >
                      <MultiSelectInput
                        label="Tags"
                        placeholder="No tags"
                        searchPlaceholder="Search tags..."
                        icon="ti ti-tags"
                        value={selectedTagIds}
                        options={props.tags.map((tag) => ({ id: tag.id, label: tag.name, color: tag.color }))}
                        onValueChange={updateTags}
                        disabled={isLoading()}
                        clearable
                      />
                    </Show>
                  </div>
                </DetailPanel.Section>
              </Show>

              <Show when={canShowAssignees()}>
                <DetailPanel.Section title="Assignees" icon="ti ti-users" tone="neutral">
                  <AssigneesSection
                    spaceId={props.spaceId}
                    assignees={props.item.assignees ?? []}
                    onUpdate={(ids) => updateMutation.mutate({ assigneeIds: ids })}
                    loading={isLoading()}
                    disabled={!canEditItem()}
                  />
                </DetailPanel.Section>
              </Show>
            </DetailPanel.Group>
          </Show>

          <Show when={props.canWrite || commentsPage().total > 0}>
            <CommentsSection
              spaceId={props.spaceId}
              itemId={props.commentTarget.itemId}
              recurrenceId={props.commentTarget.recurrenceId}
              comments={commentsPage().items}
              total={commentsPage().total}
              hasMore={commentsPage().hasNext}
              loadingMore={loadEarlierCommentsMutation.loading()}
              onLoadMore={() => loadEarlierCommentsMutation.mutate(undefined)}
              currentUserId={props.currentUserId}
              onUpdate={refreshComments}
              dateConfig={props.dateConfig}
              canWrite={props.canWrite}
            />
          </Show>

          <DetailPanel.Section title="Item information" icon="ti ti-info-circle" tone="neutral" collapsible>
            <DescriptionList
              layout="rows"
              size="sm"
              items={[
                { term: "Created", description: dates.formatDateTime(props.item.createdAt) },
                { term: "Updated", description: dates.formatDateTime(props.item.updatedAt) },
                { term: "ID", description: <span class="break-all font-mono text-dimmed">{props.item.id}</span> },
              ]}
            />
          </DetailPanel.Section>
        </DetailPanel.Body>
      </DetailPanel>
    </div>
  );
}
