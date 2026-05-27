import { apiClient } from "@/api/client";
import { prompts, toast } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import type { SpaceColumn, SpaceItem, SpaceTag } from "@/contracts";
import ItemForm, { type ItemFormData } from "../shared/ItemForm";
import { requestCurrentSpacesRouteRefresh } from "../workspace/workspace-events";

type Props = {
  spaceId: string;
  columns: SpaceColumn[];
  tags: SpaceTag[];
  variant?: "primary" | "secondary" | "sidebar" | "chip";
};

export default function CreateItemButton(props: Props) {
  const mutation = mutations.create<SpaceItem | null, void>({
    mutation: async () => {
      const result = await prompts.dialog<ItemFormData | null>(
        (close) => <ItemForm columns={props.columns} tags={props.tags} onSubmit={(data) => close(data)} onCancel={() => close(null)} />,
        { title: "New Item", icon: "ti ti-plus" },
      );
      if (!result) return null;

      const res = await apiClient[":id"].items.$post({
        param: { id: props.spaceId },
        json: result,
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
      <button
        type="button"
        onClick={() => mutation.mutate(undefined)}
        disabled={mutation.loading()}
        class="sidebar-item w-full min-h-8 px-2 py-1.5 text-xs text-green-600 dark:text-green-400 bg-green-500/10 hover:bg-green-500/20"
      >
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
