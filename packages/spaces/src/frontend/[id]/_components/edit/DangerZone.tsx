import { navigateTo } from "@k2b/ssr/nav";
import { mutation as mutations } from "@k2b/stdlib/solid";
import { Button, prompts, SettingsGroup, toast } from "@k2b/ui";
import { apiClient } from "@/api/client";
import { readErrorMessage } from "./utils";

export function DangerZone(props: { spaceId: string; spaceName: string }) {
  const deleteMut = mutations.create<void, { spaceId: string }>({
    mutation: async ({ spaceId }) => {
      const res = await apiClient[":id"].$delete({
        param: { id: spaceId },
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, "Failed to delete space"));
      }
    },
    onSuccess: () => {
      toast.success("Space deleted");
      navigateTo("/app/spaces");
    },
    onError: (err) => prompts.error(err.message),
  });
  let confirmPending = false;
  const confirmDelete = async () => {
    if (confirmPending || deleteMut.loading()) return;
    confirmPending = true;
    try {
      const confirmed = await prompts.confirm(
        `Are you sure you want to delete "${props.spaceName}"? This will permanently delete all items, tags, and comments. This action cannot be undone.`,
        { title: "Delete Space", variant: "danger" },
      );
      if (confirmed) void deleteMut.mutate({ spaceId: props.spaceId });
    } finally {
      confirmPending = false;
    }
  };

  return (
    <SettingsGroup title="Delete Space" description="Permanently delete this Space, its items, tags, and comments. This cannot be undone.">
      <SettingsGroup.Action>
        <Button type="button" variant="danger" onClick={() => void confirmDelete()} disabled={deleteMut.loading()}>
          <i class={`ti ${deleteMut.loading() ? "ti-loader-2 animate-spin" : "ti-trash"}`} aria-hidden="true" />
          Delete Space
        </Button>
      </SettingsGroup.Action>
    </SettingsGroup>
  );
}
