import { navigateTo, prompts, toast } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { apiClient } from "@/api/client";

type Props = {
  bookId: string;
  bookName: string;
};

/** Deletes a manual contact book after explicit user confirmation. */
export default function DeleteBookButton(props: Props) {
  const mutation = mutations.create<boolean, void>({
    mutation: async () => {
      const confirmed = await prompts.confirm(`Delete book "${props.bookName}" and all contained contacts?`, {
        title: "Delete Book",
        icon: "ti ti-trash",
        variant: "danger",
        confirmText: "Delete",
        cancelText: "Cancel",
      });
      if (!confirmed) return false;

      const response = await apiClient.books[":bookId"].$delete({
        param: { bookId: props.bookId },
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(data.message ?? "Failed to delete book");
      }
      return true;
    },
    onSuccess: (deleted) => {
      if (!deleted) return;
      toast.success("Contact book deleted");
      navigateTo("/app/contacts");
    },
    onError: (error) => {
      prompts.error(error.message);
    },
  });

  return (
    <button type="button" class="btn-danger btn-sm" disabled={mutation.loading()} onClick={() => mutation.mutate(undefined)}>
      {mutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-trash" />}
      Delete Book
    </button>
  );
}
