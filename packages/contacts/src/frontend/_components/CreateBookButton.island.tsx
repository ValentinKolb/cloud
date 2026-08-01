import { navigateTo } from "@k2b/ssr/nav";
import { mutation as mutations } from "@k2b/stdlib/solid";
import { AppWorkspace, Button, type ButtonVariant, prompts, toast } from "@k2b/ui";
import { apiClient } from "@/api/client";
import { readErrorMessage } from "./api";

type Props = {
  class?: string;
  label?: string;
  variant?: "button" | "icon";
  buttonVariant?: ButtonVariant;
};

/**
 * Opens a modal to create a new contact book and redirects to the created book.
 */
export default function CreateBookButton(props: Props) {
  const mutation = mutations.create<{ id: string } | null, void>({
    mutation: async () => {
      const result = await prompts.form({
        title: "New Contact Book",
        icon: "ti ti-cube-plus",
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

      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to create contact book"));

      return await response.json();
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
  if (props.variant === "icon") {
    return (
      <AppWorkspace.SidebarIconAction
        icon={mutation.loading() ? "ti ti-loader-2 k2b-spin" : "ti ti-cube-plus"}
        label={props.label ?? "New book"}
        disabled={mutation.loading()}
        onClick={() => mutation.mutate(undefined)}
      />
    );
  }

  return (
    <Button
      variant={props.buttonVariant ?? "secondary"}
      size="sm"
      class={props.class}
      loading={mutation.loading()}
      loadingLabel="Creating book"
      data-contacts-editor={mutation.loading() ? "true" : undefined}
      onClick={() => mutation.mutate(undefined)}
      aria-label="Create new contact book"
    >
      <i class="ti ti-cube-plus" aria-hidden="true" />
      {props.label ?? "New book"}
    </Button>
  );
}
