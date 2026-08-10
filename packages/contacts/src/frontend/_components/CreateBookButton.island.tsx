import { navigateTo } from "@k2b/ssr/nav";
import { mutation as mutations } from "@k2b/stdlib/solid";
import { AppWorkspace, Button, type ButtonVariant, prompts, toast } from "@k2b/ui";
import { createSignal, onCleanup } from "solid-js";
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
  const [prompting, setPrompting] = createSignal(false);
  let disposed = false;
  const mutation = mutations.create<{ id: string }, { name: string; description?: string }>({
    mutation: async (payload, { abortSignal }) => {
      const response = await apiClient.books.$post({ json: payload }, { init: { signal: abortSignal } });

      if (!response.ok) throw new Error(await readErrorMessage(response, "Failed to create contact book"));

      return response.json();
    },
    onSuccess: (book) => {
      toast.success("Contact book created");
      navigateTo(`/app/contacts/${book.id}`);
    },
    onError: (error) => {
      prompts.error(error.message);
    },
  });

  onCleanup(() => {
    disposed = true;
    mutation.abort();
  });

  const createBook = async () => {
    if (prompting() || mutation.loading()) return;
    setPrompting(true);
    try {
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
      if (!result || disposed) return;
      void mutation.mutate({ name: result.name.trim(), description: result.description?.trim() || undefined });
    } catch (error) {
      if (!disposed) void prompts.error(error instanceof Error ? error.message : "Could not open the contact book form");
    } finally {
      if (!disposed) setPrompting(false);
    }
  };

  const busy = () => prompting() || mutation.loading();
  if (props.variant === "icon") {
    return (
      <AppWorkspace.SidebarIconAction
        icon={busy() ? "ti ti-loader-2 k2b-spin" : "ti ti-cube-plus"}
        label={props.label ?? "New book"}
        disabled={busy()}
        onClick={() => void createBook()}
      />
    );
  }

  return (
    <Button
      variant={props.buttonVariant ?? "secondary"}
      size="sm"
      class={props.class}
      loading={busy()}
      loadingLabel="Creating book"
      data-contacts-editor={busy() ? "true" : undefined}
      onClick={() => void createBook()}
      aria-label="Create new contact book"
    >
      <i class="ti ti-cube-plus" aria-hidden="true" />
      {props.label ?? "New book"}
    </Button>
  );
}
