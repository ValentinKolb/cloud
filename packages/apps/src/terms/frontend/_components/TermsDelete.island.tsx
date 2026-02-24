import { mutation as mutations } from "@valentinkolb/cloud/lib/browser";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { apiClient } from "@/terms/client";
import { refreshCurrentPath } from "../lib/navigation";

type Props = {
  id: string;
};

export default function TermsDelete(props: Props) {
  const mutation = mutations.create<unknown, void>({
    mutation: async () => {
      const res = await apiClient[":id"].$delete({
        param: { id: props.id },
      });
      if (!res.ok) throw new Error("Failed to delete version");
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (err) => prompts.error(err.message),
  });

  const handleDelete = async () => {
    const confirmed = await prompts.confirm("Delete this terms version? This cannot be undone.", {
      title: "Delete Version",
      icon: "ti ti-trash",
      variant: "danger",
    });
    if (confirmed) mutation.mutate();
  };

  return (
    <button type="button" class="btn-simple btn-sm text-red-500 hover:text-red-700" onClick={handleDelete} disabled={mutation.loading()}>
      <i class={mutation.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-trash"} />
    </button>
  );
}
