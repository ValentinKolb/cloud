import { mutation as mutations } from "@valentinkolb/cloud/lib/browser";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { apiClient } from "@/contacts/client";

type Props = {
  buttonClass?: string;
  label?: string;
};

/**
 * Opens a modal to create a new contact book and redirects to the created book.
 */
export default function CreateBookButton(props: Props) {
  const mutation = mutations.create<{ id: string }, { name: string; description?: string }>({
    mutation: async (data) => {
      const response = await apiClient.books.$post({
        json: {
          name: data.name,
          description: data.description || undefined,
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
      window.location.href = `/app/contacts/${book.id}`;
    },
    onError: (error) => {
      prompts.error(error.message);
    },
  });

  const handleCreate = async () => {
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

    if (!result) return;

    await mutation.mutate({
      name: result.name.trim(),
      description: result.description?.trim() || undefined,
    });
  };

  return (
    <button
      type="button"
      class={props.buttonClass ?? "btn-primary btn-sm w-full"}
      disabled={mutation.loading()}
      onClick={handleCreate}
      aria-label="Create new contact book"
    >
      {mutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-plus" />}
      {props.label ?? "New Book"}
    </button>
  );
}
