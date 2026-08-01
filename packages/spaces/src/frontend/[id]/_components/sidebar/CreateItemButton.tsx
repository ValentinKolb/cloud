import type { DateContext } from "@k2b/stdlib";
import { mutation as mutations } from "@k2b/stdlib/solid";
import { AppWorkspace, Button, dialogCore, IconButton, panelDialogFixedOptions, prompts, Tooltip, toast } from "@k2b/ui";
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
        panelDialogFixedOptions,
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
      <Button type="button" size="sm" onClick={() => mutation.mutate(undefined)} disabled={mutation.loading()}>
        {mutation.loading() ? (
          <i class="ti ti-loader-2 animate-spin" />
        ) : (
          <>
            <i class="ti ti-plus" />
            <span>{label()}</span>
          </>
        )}
      </Button>
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
      <Tooltip content={label()}>
        <IconButton label={label()} size="sm" onClick={() => mutation.mutate(undefined)} disabled={mutation.loading()}>
          <i class={`ti ${mutation.loading() ? "ti-loader-2 animate-spin" : "ti-plus"} text-base`} />
        </IconButton>
      </Tooltip>
    );
  }

  if (props.variant === "inline") {
    return (
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => mutation.mutate(undefined)}
        disabled={mutation.loading()}
        class="w-full justify-start text-left text-[11px] text-dimmed hover:text-primary [&_.k2b-button__label]:w-full [&_.k2b-button__label]:justify-start"
      >
        <i class={`ti ${mutation.loading() ? "ti-loader-2 animate-spin" : "ti-plus"} text-xs`} />
        <span>{defaultType() === "event" ? "Add event" : "Add task"}</span>
      </Button>
    );
  }

  return (
    <Button type="button" onClick={() => mutation.mutate(undefined)} disabled={mutation.loading()} class="w-full">
      {mutation.loading() ? (
        <i class="ti ti-loader-2 animate-spin" />
      ) : (
        <>
          <i class="ti ti-plus" />
          <span>{label()}</span>
        </>
      )}
    </Button>
  );
}
