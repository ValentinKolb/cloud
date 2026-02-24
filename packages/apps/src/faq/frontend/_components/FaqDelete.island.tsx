import { mutation as mutations } from "@valentinkolb/cloud/lib/browser";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { apiClient } from "@/faq/client";
import { refreshCurrentPath } from "../lib/navigation";

type Props = {
  id: string;
};

const getErrorMessage = async (response: Response, fallback: string) => {
  const data = (await response.json().catch(() => null)) as { message?: string } | null;
  return data?.message ?? fallback;
};

const FaqDelete = (props: Props) => {
  const mutation = mutations.create<void, void>({
    mutation: async () => {
      const res = await apiClient[":id"].$delete({
        param: { id: props.id },
      });
      if (!res.ok) throw new Error(await getErrorMessage(res, "Failed to delete FAQ"));
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (err) => prompts.error(err.message),
  });

  const handleDelete = async () => {
    const confirmed = await prompts.confirm("Delete this FAQ entry?", {
      title: "Delete FAQ",
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
};

export default FaqDelete;
