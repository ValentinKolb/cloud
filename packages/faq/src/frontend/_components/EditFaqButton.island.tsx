import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { prompts } from "@valentinkolb/cloud/ui";
import { refreshCurrentPath } from "@valentinkolb/ssr/nav";
import { apiClient } from "@/api/client";
import type { FaqEntry, FaqAudience, UpdateFaq } from "@/contracts";

export default function EditFaqButton(props: { entry: FaqEntry }) {
  const mutation = mutations.create<unknown, UpdateFaq>({
    mutation: async (data) => {
      const res = await apiClient[":id"].$patch({
        param: { id: props.entry.id },
        json: data,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? "Failed to update FAQ entry");
      }
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (err) => prompts.error(err.message),
  });

  const handleClick = async () => {
    const audienceSet = new Set<FaqAudience>(props.entry.audience);
    const result = await prompts.form({
      title: "Edit FAQ Entry",
      icon: "ti ti-pencil",
      confirmText: "Save",
      fields: {
        question: {
          type: "text" as const,
          label: "Question",
          required: true,
          default: props.entry.question,
        },
        answer: {
          type: "text" as const,
          label: "Answer (Markdown)",
          multiline: true,
          required: true,
          default: props.entry.answer,
        },
        audienceAnonymous: {
          type: "boolean" as const,
          label: "Anonymous (logged-out)",
          description: "Visible to anyone, including logged-out visitors.",
          default: audienceSet.has("anonymous"),
        },
        audienceGuest: {
          type: "boolean" as const,
          label: "Guests",
          description: "Visible to local-guest accounts.",
          default: audienceSet.has("guest"),
        },
        audienceUser: {
          type: "boolean" as const,
          label: "Full users",
          description: "Visible to local-user / IPA-user accounts.",
          default: audienceSet.has("user"),
        },
      },
    });

    if (!result) return;

    const audience: FaqAudience[] = [];
    if (result.audienceAnonymous) audience.push("anonymous");
    if (result.audienceGuest) audience.push("guest");
    if (result.audienceUser) audience.push("user");

    if (audience.length === 0) {
      prompts.error("Pick at least one audience.");
      return;
    }

    mutation.mutate({
      question: result.question.trim(),
      answer: result.answer.trim(),
      audience,
    });
  };

  return (
    <button type="button" class="btn-simple btn-sm" onClick={handleClick} disabled={mutation.loading()} aria-label="Edit" title="Edit">
      {mutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-pencil" />}
    </button>
  );
}
