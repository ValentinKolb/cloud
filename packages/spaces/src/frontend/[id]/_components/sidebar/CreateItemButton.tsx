import { apiClient } from "@/api/client";
import { AppWorkspace, dialogCore, panelDialogOptions, prompts, toast } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import type { SpaceColumn, SpaceItem, SpaceTag } from "@/contracts";
import ItemForm, { type ItemFormData } from "../shared/ItemForm";
import { requestCurrentSpacesRouteRefresh } from "../workspace/workspace-events";

type Props = {
  spaceId: string;
  columns: SpaceColumn[];
  tags: SpaceTag[];
  variant?: "primary" | "secondary" | "sidebar" | "chip" | "icon";
};

export default function CreateItemButton(props: Props) {
  const mutation = mutations.create<SpaceItem | null, void>({
    mutation: async () => {
      const result = await dialogCore.open<ItemFormData | null>(
        (close) => (
          <ItemForm
            columns={props.columns}
            tags={props.tags}
            onSubmit={(data) => close(data)}
            onCancel={() => close(null)}
            title="New item"
            icon="ti ti-plus"
          />
        ),
        panelDialogOptions,
      );
      if (!result) return null;

      const res = await apiClient[":id"].items.$post({
        param: { id: props.spaceId },
        json: { ...result, priority: result.priority ?? undefined },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error("message" in data ? data.message : "Failed to create item");
      }
      return res.json();
    },
    onSuccess: (item) => {
      if (!item) return;
      toast.success("Item created");
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
            <span>New Item</span>
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
        New Item
      </AppWorkspace.SidebarItem>
    );
  }

  if (props.variant === "icon") {
    return (
      <button
        type="button"
        onClick={() => mutation.mutate(undefined)}
        disabled={mutation.loading()}
        class="sidebar-icon-action sidebar-icon-action-success"
        title="New Item"
        aria-label="New Item"
      >
        <i class={`ti ${mutation.loading() ? "ti-loader-2 animate-spin" : "ti-plus"} text-base`} />
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
          <span class="text-emerald-700 dark:text-emerald-300">New Item</span>
        </>
      )}
    </button>
  );
}
