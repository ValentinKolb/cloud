import { mutation as mutations } from "@valentinkolb/cloud/lib/browser";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { apiClient } from "@/terms/client";
import { refreshCurrentPath } from "../lib/navigation";

export default function TermsForm() {
  const mutation = mutations.create<unknown, string>({
    mutation: async (content) => {
      const res = await apiClient.index.$post({
        json: { content },
      });
      if (!res.ok) throw new Error("Failed to create terms version");
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (err) => prompts.error(err.message),
  });

  const handleClick = async () => {
    const result = await prompts.form({
      title: "New Terms Version",
      icon: "ti ti-file-text",
      fields: {
        content: {
          type: "text",
          label: "Content (Markdown)",
          placeholder: "Paste the terms of service content here...",
          multiline: true,
          required: true,
        },
        info: {
          type: "info",
          content: "Content is rendered as Markdown. Once published, a version cannot be edited — only deleted.",
        },
      },
      confirmText: "Publish",
    });

    if (result) {
      mutation.mutate(result.content);
    }
  };

  return (
    <button type="button" class="btn-primary btn-sm" onClick={handleClick} disabled={mutation.loading()}>
      {mutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-plus" />}
      New Version
    </button>
  );
}
