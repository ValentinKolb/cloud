import { navigateTo, prompts, toast } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { apiClient } from "@/api/client";

type Props = {
  buttonClass?: string;
  label?: string;
};

/**
 * Opens a modal to create a new contact book and redirects to the created book.
 */
export default function CreateBookButton(props: Props) {
  const mutation = mutations.create<{ id: string } | null, void>({
    mutation: async () => {
      const result = await prompts.form({
        title: "New Contact Book",
        icon: "ti ti-address-book",
        confirmText: "Create",
        fields: {
          name: {
            type: "text",
            label: "Book name",
            placeholder: "Sales Contacts",
            required: true,
          },
          description: {
            type: "text",
            label: "Description",
            placeholder: "Optional",
            multiline: true,
          },
        },
      });
      if (!result) return null;

      const response = await apiClient.books.$post({
        json: {
          name: result.name.trim(),
          description: result.description?.trim() || undefined,
        },
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(body.message ?? "Failed to create contact book");
      }

      return (await response.json()) as { id: string };
    },
    onSuccess: (book) => {
      if (!book) return;
      toast.success("Contact book created");
      navigateTo(`/app/contacts/${book.id}`);
    },
    onError: (error) => {
      prompts.error(error.message);
    },
  });

  return (
    <button
      type="button"
      class={props.buttonClass ?? "btn-primary btn-sm w-full"}
      disabled={mutation.loading()}
      onClick={() => mutation.mutate(undefined)}
      aria-label="Create new contact book"
    >
      {mutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-plus" />}
      {props.label ?? "New Book"}
    </button>
  );
}
