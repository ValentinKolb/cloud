import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { apiClient } from "@/api/client";
import { prompts, toast } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import type { SpaceColumn, SpaceItem, SpaceTag } from "@/contracts";
import { dates, type DateContext } from "@valentinkolb/stdlib";
import { shouldHandleDetailClick, subscribeToDetailSelection } from "../../../lib/detail";
import { requestCurrentSpacesRouteRefresh, requestSpacesRouteNavigation } from "../workspace/workspace-events";

type ItemRowProps = {
  item: SpaceItem;
  spaceId: string;
  columns: SpaceColumn[];
  tags: SpaceTag[];
  isSelected: boolean;
  /** Base URL for item links (without item param) */
  baseUrl: string;
  dateConfig?: DateContext;
};

const PRIORITY_STYLES: Record<string, { icon: string; color: string }> = {
  urgent: { icon: "ti-alert-circle", color: "text-red-500" },
  high: { icon: "ti-arrow-up", color: "text-orange-500" },
  medium: { icon: "ti-minus", color: "text-yellow-500" },
  low: { icon: "ti-arrow-down", color: "text-blue-500" },
};

/**
 * Item row - displays item info and links to detail view.
 * Only the completion toggle is interactive here.
 */
export default function ItemRow(props: ItemRowProps) {
  const [isSelectedLocal, setIsSelectedLocal] = createSignal(props.isSelected);

  createEffect(() => {
    setIsSelectedLocal(props.isSelected);
  });

  onMount(() => {
    const unsubscribe = subscribeToDetailSelection(({ itemId }) => {
      setIsSelectedLocal(itemId === props.item.id);
    });
    onCleanup(unsubscribe);
  });

  const completeMutation = mutations.create<boolean, boolean>({
    mutation: async (completed: boolean) => {
      const res = await apiClient[":id"].items[":itemId"].completed.$post({
        param: { id: props.spaceId, itemId: props.item.id },
        json: { completed },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error("message" in data ? data.message : "Failed to update");
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
  const isCompleted = () => !!props.item.completedAt;
  const isEvent = () => !!(props.item.startsAt && props.item.endsAt);
  const priority = () => (props.item.priority ? PRIORITY_STYLES[props.item.priority] : null);
  const isOverdue = () => props.item.deadline && new Date(props.item.deadline) < new Date() && !isCompleted();

  const itemUrl = () => {
    const sep = props.baseUrl.includes("?") ? "&" : "?";
    return `${props.baseUrl}${sep}item=${props.item.id}`;
  };
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={(event) => {
        if (!shouldHandleDetailClick(event)) return;
        event.preventDefault();
        requestSpacesRouteNavigation(itemUrl(), { scroll: "preserve" });
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        requestSpacesRouteNavigation(itemUrl(), { scroll: "preserve" });
      }}
      class={`group flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 transition-colors ${
        isSelectedLocal()
          ? "border-blue-500 bg-blue-500/[0.08] ring-1 ring-blue-500 dark:border-blue-400 dark:bg-blue-400/10 dark:ring-blue-400"
          : "border-zinc-200 bg-white [box-shadow:var(--theme-bevel-top),var(--theme-bevel-bottom)] hover:border-blue-500/45 hover:bg-blue-500/[0.04] dark:border-zinc-700/70 dark:bg-zinc-900 dark:hover:border-blue-400/45 dark:hover:bg-blue-400/[0.06]"
      }`}
    >
      {/* Completion Toggle */}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          completeMutation.mutate(!isCompleted());
        }}
        disabled={completeMutation.loading()}
        class={`w-5 h-5 rounded border flex items-center justify-center transition-colors shrink-0 ${
          isCompleted()
            ? "border-emerald-500 bg-emerald-500 text-white [box-shadow:inset_0_1px_0_0_rgb(255_255_255/0.35)]"
            : "border-zinc-300 bg-white hover:border-emerald-500 dark:border-zinc-600 dark:bg-zinc-900 [box-shadow:var(--theme-recess-sm)]"
        }`}
        aria-label={isCompleted() ? "Mark incomplete" : "Mark complete"}
      >
        <Show when={isCompleted() || completeMutation.loading()}>
          <i class={`ti ${completeMutation.loading() ? "ti-loader-2 animate-spin" : "ti-check"} text-xs`} />
        </Show>
      </button>

      {/* Item Link - Main content area */}
      <a href={itemUrl()} class="flex-1 min-w-0 flex items-center gap-3">
        {/* Priority Icon */}
        <Show when={priority()}>
          <i class={`ti ${priority()!.icon} ${priority()!.color} text-sm shrink-0`} />
        </Show>

        {/* Title */}
        <span class={`font-medium text-sm truncate ${isCompleted() ? "line-through text-dimmed" : ""}`}>{props.item.title}</span>

        {/* Spacer */}
        <div class="flex-1" />

        {/* Meta info - Desktop */}
        <div class="hidden sm:flex items-center gap-3 shrink-0">
          {/* Event badge */}
          <Show when={isEvent()}>
            <span class="text-xs text-purple-500 flex items-center gap-1">
              <i class="ti ti-calendar-event" />
              Event
            </span>
          </Show>

          {/* Deadline */}
          <Show when={props.item.deadline}>
            <span class={`text-xs flex items-center gap-1 ${isOverdue() ? "text-red-500" : "text-dimmed"}`}>
              <i class="ti ti-clock" />
              {dates.formatDateRelative(props.item.deadline!)}
            </span>
          </Show>

          {/* Tags */}
          <Show when={props.item.tags?.length}>
            <div class="flex items-center gap-1">
              <For each={props.item.tags!.slice(0, 3)}>
                {(tag) => (
                  <span class="px-1.5 py-0.5 rounded text-xs" style={`background-color: ${tag.color}20; color: ${tag.color}`}>
                    {tag.name}
                  </span>
                )}
              </For>
              <Show when={(props.item.tags?.length ?? 0) > 3}>
                <span class="text-xs text-dimmed">+{props.item.tags!.length - 3}</span>
              </Show>
            </div>
          </Show>

          {/* Assignees */}
          <Show when={props.item.assignees?.length}>
            <div class="flex items-center -space-x-1">
              <For each={props.item.assignees!.slice(0, 3)}>
                {(assignee) => (
                  <div
                    class="w-6 h-6 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-xs border-2 border-white dark:border-zinc-900"
                    title={assignee.displayName}
                  >
                    {assignee.displayName.charAt(0).toUpperCase()}
                  </div>
                )}
              </For>
              <Show when={(props.item.assignees?.length ?? 0) > 3}>
                <div class="w-6 h-6 rounded-full bg-zinc-300 dark:bg-zinc-600 flex items-center justify-center text-xs border-2 border-white dark:border-zinc-900">
                  +{props.item.assignees!.length - 3}
                </div>
              </Show>
            </div>
          </Show>
        </div>

        {/* Chevron */}
        <i class="ti ti-chevron-right text-dimmed text-sm shrink-0" />
      </a>
    </div>
  );
}
