import { AppWorkspace, dialogCore, panelDialogOptions, prompts, toast } from "@valentinkolb/cloud/ui";
import type { DateContext } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { apiClient } from "@/api/client";
import type { SpaceColumn, SpaceItem, SpaceTag } from "@/contracts";
import { readResponseError } from "../../../lib/response";
import ItemForm, { type ItemFormData } from "../shared/ItemForm";
import type { ItemType } from "../shared/item-form/types";
import { requestCurrentSpacesRouteRefresh } from "../workspace/workspace-events";

type Props = {
  spaceId: string;
  columns: SpaceColumn[];
  tags: SpaceTag[];
  dateConfig?: DateContext;
  variant?: "primary" | "secondary" | "sidebar" | "chip" | "icon" | "inline";
  defaultType?: ItemType;
  defaultColumnId?: string;
};

export default function CreateItemButton(props: Props) {
  const defaultType = () => props.defaultType ?? "task";
  const label = () => (defaultType() === "event" ? "New event" : "New task");
  const mutation = mutations.create<SpaceItem | null, void>({
    mutation: async () => {
      const result = await dialogCore.open<ItemFormData | null>(
        (close) => (
          <ItemForm
            spaceId={props.spaceId}
            columns={props.columns}
            tags={props.tags}
            defaults={{ type: defaultType(), columnId: props.defaultColumnId }}
            onSubmit={(data) => close(data)}
            onCancel={() => close(null)}
            title={label()}
            icon={defaultType() === "event" ? "ti ti-calendar-plus" : "ti ti-square-plus"}
            dateConfig={props.dateConfig}
          />
        ),
        panelDialogOptions,
      );
      if (!result) return null;

      const res = await apiClient[":id"].items.$post({
        param: { id: props.spaceId },
        json: {
          ...result,
          location: result.location ?? undefined,
          url: result.url ?? undefined,
          priority: result.priority ?? undefined,
          recurrence: result.recurrence ?? undefined,
        },
      });
      if (!res.ok) {
        throw new Error(await readResponseError(res, "Failed to create item"));
      }
      return res.json();
    },
    onSuccess: (item) => {
      if (!item) return;
      toast.success(defaultType() === "event" ? "Event created" : "Task created");
      requestCurrentSpacesRouteRefresh();
    },
    onError: (err) => prompts.error(err.message),
  });

  if (props.variant === "chip") {
    return (
      <button type="button" onClick={() => mutation.mutate(undefined)} disabled={mutation.loading()} class="btn-primary btn-sm">
        {mutation.loading() ? (
          <i class="ti ti-loader-2 animate-spin" />
        ) : (
          <>
            <i class="ti ti-plus" />
            <span>{label()}</span>
          </>
        )}
      </button>
    );
  }

  if (props.variant === "sidebar") {
    return (
      <AppWorkspace.SidebarItem
        onClick={() => mutation.mutate(undefined)}
        disabled={mutation.loading()}
        tone="success"
        icon={mutation.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-plus"}
      >
        {label()}
      </AppWorkspace.SidebarItem>
    );
  }

  if (props.variant === "icon") {
    return (
      <button
        type="button"
        onClick={() => mutation.mutate(undefined)}
        disabled={mutation.loading()}
        class="sidebar-icon-action"
        title={label()}
        aria-label={label()}
      >
        <i class={`ti ${mutation.loading() ? "ti-loader-2 animate-spin" : "ti-plus"} text-base`} />
      </button>
    );
  }

  if (props.variant === "inline") {
    return (
      <button
        type="button"
        onClick={() => mutation.mutate(undefined)}
        disabled={mutation.loading()}
        class="focus-ui flex w-full items-center gap-1.5 rounded-[var(--ui-radius-control)] px-2 py-1.5 text-left text-[11px] font-medium text-dimmed transition-colors hover:bg-[var(--ui-hover)] hover:text-primary"
      >
        <i class={`ti ${mutation.loading() ? "ti-loader-2 animate-spin" : "ti-plus"} text-xs`} />
        <span>{defaultType() === "event" ? "Add event" : "Add task"}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => mutation.mutate(undefined)}
      disabled={mutation.loading()}
      class="w-full flex items-center justify-center gap-1 text-sm font-medium transition-colors bg-emerald-50/30 dark:bg-emerald-900/10 hover:bg-emerald-50/50 dark:hover:bg-emerald-900/20 disabled:opacity-50 px-3 py-2 rounded-lg border border-emerald-200/50 dark:border-emerald-900/30"
    >
      {mutation.loading() ? (
        <i class="ti ti-loader-2 animate-spin" />
      ) : (
        <>
          <i class="ti ti-plus text-emerald-600 dark:text-emerald-400" />
          <span class="text-emerald-700 dark:text-emerald-300">{label()}</span>
        </>
      )}
    </button>
  );
}
