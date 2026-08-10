import { mutation as mutations } from "@k2b/stdlib/solid";
import { Button, prompts, toast } from "@k2b/ui";
import { apiClient } from "@/api/client";
import { readErrorMessage } from "./api";

type Props = {
  bookId: string;
  bookName: string;
  onDeleted: () => void;
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

      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to delete book"));
      return true;
    },
    onSuccess: (deleted) => {
      if (!deleted) return;
      toast.success("Contact book deleted");
      props.onDeleted();
    },
    onError: (error) => {
      prompts.error(error.message);
    },
  });

  return (
    <Button type="button" variant="danger" size="sm" loading={mutation.loading()} onClick={() => mutation.mutate(undefined)}>
      <i class="ti ti-trash" />
      Delete Book
    </Button>
  );
}
