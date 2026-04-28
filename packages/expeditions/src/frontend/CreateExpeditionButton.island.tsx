import { apiClient } from "@/api/client";
import { prompts, navigateTo } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";

/**
 * "New expedition" button — single island for the list page.
 *
 * The pattern in three steps:
 *   1. `prompts.form` opens a typed dialog and resolves with the field values.
 *   2. `mutations.create` wraps the POST so we get a reactive `loading()`
 *      signal for the spinner and structured success / error callbacks.
 *   3. On success we navigate to the new detail page (no full reload).
 *
 * Errors surface via `prompts.error` (the platform's toast variant).
 */
type CreatedExpedition = { id: string };

const CreateExpeditionButton = () => {
  const mutation = mutations.create<CreatedExpedition, { title: string; description?: string }>({
    mutation: async (data) => {
      const res = await apiClient.index.$post({ json: data });
      if (!res.ok) {
        const body = await res.json();
        throw new Error("message" in body ? body.message : "Failed to create expedition");
      }
      return (await res.json()) as CreatedExpedition;
    },
    onSuccess: (created) => navigateTo(`/app/expeditions/${created.id}`),
    onError: (e) => prompts.error(e.message),
  });

  const handleClick = async () => {
    const result = await prompts.form({
      title: "New expedition",
      icon: "ti ti-map-2",
      fields: {
        title: {
          type: "text",
          label: "Title",
          required: true,
          placeholder: "e.g. Climb Mt. Everest",
        },
        description: {
          type: "text",
          label: "Description",
          multiline: true,
          placeholder: "Optional — what's the journey about?",
        },
      },
    });
    if (result) mutation.mutate(result);
  };

  return (
    <button
      type="button"
      class="btn-primary btn-sm inline-flex items-center gap-2"
      disabled={mutation.loading()}
      onClick={handleClick}
    >
      {mutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-plus" />}
      New expedition
    </button>
  );
};

export default CreateExpeditionButton;
