import { refreshCurrentPath } from "@k2b/ssr/nav";
import { mutation as mutations } from "@k2b/stdlib/solid";
import { IconButton, prompts, Tooltip, toast } from "@k2b/ui";
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
    onSuccess: () => {
      toast.success("FAQ entry deleted");
      refreshCurrentPath();
    },
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
    <Tooltip content="Delete FAQ entry">
      <IconButton
        size="sm"
        variant="danger"
        label={`Delete ${props.question}`}
        onClick={handleClick}
        loading={mutation.loading()}
        loadingLabel={`Deleting ${props.question}`}
      >
        <i class="ti ti-trash" aria-hidden="true" />
      </IconButton>
    </Tooltip>
  );
}
