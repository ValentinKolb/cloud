import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { prompts, toast } from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";
import { apiClient } from "@/api/client";

export default function DeleteLocationButton(props: { id: string }) {
  const mutation = mutations.create({
    mutation: async () => {
      const confirmed = await prompts.confirm("Remove this location?", {
        title: "Remove Location",
        variant: "danger",
      });
      if (!confirmed) return false;

      const res = await apiClient.locations[":id"].$delete({
        param: { id: props.id },
      });
      if (!res.ok) {
        const data = (await res.json()) as { message?: string };
        throw new Error(data.message ?? "Failed to delete");
      }
      await res.json();
      return true;
    },
    onSuccess: (deleted) => {
      if (!deleted) return;
      toast.success("Location removed");
      navigateTo("/app/weather");
    },
    onError: (err) => prompts.error(err.message),
  });

  return (
    <button class="btn-secondary btn-sm" disabled={mutation.loading()} onClick={() => mutation.mutate({})}>
      {mutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-trash" />}
      Remove
    </button>
  );
}
