import { prompts, toast } from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { apiClient } from "@/api/client";
import { readErrorMessage } from "./utils";

export function DangerZone(props: { spaceId: string; spaceName: string }) {
  const deleteMut = mutations.create({
    mutation: async () => {
      const confirmed = await prompts.confirm(
        `Are you sure you want to delete "${props.spaceName}"? This will permanently delete all items, tags, and comments. This action cannot be undone.`,
        { title: "Delete Space", variant: "danger" },
      );
      if (!confirmed) return false;

      const res = await apiClient[":id"].$delete({
        param: { id: props.spaceId },
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, "Failed to delete space"));
      }
      return true;
    },
    onSuccess: (deleted) => {
      if (!deleted) return;
      toast.success("Space deleted");
      navigateTo("/app/spaces");
    },
    onError: (err) => prompts.error(err.message),
  });

  return (
    <div class="flex flex-col gap-2">
      <p class="text-sm text-secondary">Permanently delete this space and all its contents.</p>
      <button type="button" onClick={() => deleteMut.mutate(undefined)} disabled={deleteMut.loading()} class="btn-danger btn-md self-start">
        {deleteMut.loading() ? (
          <i class="ti ti-loader-2 animate-spin" />
        ) : (
          <>
            <i class="ti ti-trash mr-1" />
            Delete Space
          </>
        )}
      </button>
    </div>
  );
}
