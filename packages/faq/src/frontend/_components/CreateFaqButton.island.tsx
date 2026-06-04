import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { prompts } from "@valentinkolb/cloud/ui";
import { refreshCurrentPath } from "@valentinkolb/ssr/nav";
import { apiClient } from "@/api/client";
import type { CreateFaq, FaqAudience } from "@/contracts";

const AUDIENCE_OPTIONS: ReadonlyArray<{ id: FaqAudience; label: string; description: string }> = [
  { id: "anonymous", label: "Anonymous (logged-out)", description: "Visible to anyone, including logged-out visitors." },
  { id: "guest", label: "Guests", description: "Visible to local-guest accounts." },
  { id: "user", label: "Full users", description: "Visible to local-user / IPA-user accounts." },
];

export default function CreateFaqButton() {
  const mutation = mutations.create<unknown, CreateFaq>({
    mutation: async (data) => {
      const res = await apiClient.index.$post({ json: data });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? "Failed to create FAQ entry");
      }
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (err) => prompts.error(err.message),
  });

  const handleClick = async () => {
    const result = await prompts.form({
      title: "New FAQ Entry",
      icon: "ti ti-plus",
      confirmText: "Create",
      fields: {
        question: {
          type: "text" as const,
          label: "Question",
          placeholder: "What is …?",
          required: true,
        },
        answer: {
          type: "text" as const,
          label: "Answer (Markdown)",
          placeholder: "Markdown supported. Links, code blocks, lists, etc.",
          multiline: true,
          required: true,
        },
        audienceAnonymous: {
          type: "boolean" as const,
          label: AUDIENCE_OPTIONS[0]!.label,
          description: AUDIENCE_OPTIONS[0]!.description,
          default: false,
        },
        audienceGuest: {
          type: "boolean" as const,
          label: AUDIENCE_OPTIONS[1]!.label,
          description: AUDIENCE_OPTIONS[1]!.description,
          default: true,
        },
        audienceUser: {
          type: "boolean" as const,
          label: AUDIENCE_OPTIONS[2]!.label,
          description: AUDIENCE_OPTIONS[2]!.description,
          default: true,
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
    <button type="button" class="btn-primary btn-sm" onClick={handleClick} disabled={mutation.loading()}>
      {mutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-plus" />}
      New Entry
    </button>
  );
}
