import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { prompts } from "@valentinkolb/cloud/ui";
import { apiClient } from "@/api/client";

export default function DeleteLocationButton(props: { id: string }) {
  const mutation = mutations.create({
    mutation: async () => {
      const res = await apiClient.locations[":id"].$delete({
        param: { id: props.id },
      });
      if (!res.ok) {
        const data = (await res.json()) as { message?: string };
        throw new Error(data.message ?? "Failed to delete");
      }
      return (await res.json()) as { message: string };
    },
    onSuccess: () => {
      window.location.href = "/app/weather";
    },
    onError: (err) => prompts.error(err.message),
  });

  const handleDelete = async () => {
    const confirmed = await prompts.confirm("Remove this location?", {
      title: "Remove Location",
      variant: "danger",
    });
    if (confirmed) {
      mutation.mutate({});
    }
  };

  return (
    <button class="btn-secondary btn-sm" disabled={mutation.loading()} onClick={handleDelete}>
      {mutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-trash" />}
      Remove
    </button>
  );
}
