import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { prompts } from "@valentinkolb/cloud/ui";
import { refreshCurrentPath } from "@valentinkolb/ssr/nav";
import { apiClient } from "@/api/client";

export default function DeleteFaqButton(props: { id: string; question: string }) {
  const mutation = mutations.create<unknown, void>({
    mutation: async () => {
      const res = await apiClient[":id"].$delete({ param: { id: props.id } });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? "Failed to delete FAQ entry");
      }
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (err) => prompts.error(err.message),
  });

  const handleClick = async () => {
    const confirmed = await prompts.confirm(`Delete FAQ entry "${props.question}"? This cannot be undone.`, {
      title: "Delete FAQ Entry?",
      icon: "ti ti-trash",
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "danger",
    });
    if (confirmed) mutation.mutate();
  };

  return (
    <button
      type="button"
      class="btn-simple btn-sm text-red-500 hover:text-red-700"
      onClick={handleClick}
      disabled={mutation.loading()}
      aria-label="Delete"
      title="Delete"
    >
      {mutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-trash" />}
    </button>
  );
}
