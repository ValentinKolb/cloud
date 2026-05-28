import { dialogCore, panelDialogOptions, toast } from "@valentinkolb/cloud/ui";
import { apiClient } from "@/api/client";
import type { SpaceColumn, SpaceItem, SpaceTag } from "@/contracts";
import { requestCurrentSpacesRouteRefresh } from "../workspace/workspace-events";
import ItemForm, { type ItemFormData } from "./ItemForm";

type EditItemParams = {
  spaceId: string;
  item: SpaceItem;
  columns: SpaceColumn[];
  tags: SpaceTag[];
};

export const saveItemFormData = async (params: { spaceId: string; itemId: string; data: ItemFormData }): Promise<void> => {
  const res = await apiClient[":id"].items[":itemId"].$patch({
    param: { id: params.spaceId, itemId: params.itemId },
    json: {
      ...params.data,
      description: params.data.description ?? null,
      priority: params.data.priority ?? null,
      deadline: params.data.deadline ?? null,
      startsAt: params.data.startsAt ?? null,
      endsAt: params.data.endsAt ?? null,
    },
  });
  if (!res.ok) throw new Error("Could not update item");
};

export const editItemWithDialog = async (params: EditItemParams): Promise<boolean> => {
  const result = await dialogCore.open<ItemFormData | null>(
    (close) => (
      <ItemForm
        item={params.item}
        columns={params.columns}
        tags={params.tags}
        onSubmit={(data) => close(data)}
        onCancel={() => close(null)}
        submitLabel="Save Item"
        title="Edit item"
        icon="ti ti-edit"
      />
    ),
    panelDialogOptions,
  );
  if (!result) return false;
  await saveItemFormData({ spaceId: params.spaceId, itemId: params.item.id, data: result });
  return true;
};

export const handleEditItemSuccess = (updated: boolean): void => {
  if (!updated) return;
  toast.success("Item updated");
  requestCurrentSpacesRouteRefresh({ scroll: "preserve" });
};
