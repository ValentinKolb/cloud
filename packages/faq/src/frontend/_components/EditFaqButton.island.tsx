import { refreshCurrentPath } from "@k2b/ssr/nav";
import { mutation as mutations } from "@k2b/stdlib/solid";
import { IconButton, prompts, Tooltip, toast } from "@k2b/ui";
import { apiClient } from "@/api/client";
import type { FaqAudience, FaqEntry, UpdateFaq } from "@/contracts";

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
    onSuccess: () => {
      toast.success("FAQ entry updated");
      refreshCurrentPath();
    },
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
    <Tooltip.Anchor content="Edit FAQ entry">
      <IconButton
        size="sm"
        label={`Edit ${props.entry.question}`}
        onClick={handleClick}
        loading={mutation.loading()}
        loadingLabel={`Editing ${props.entry.question}`}
      >
        <i class="ti ti-pencil" aria-hidden="true" />
      </IconButton>
    </Tooltip.Anchor>
  );
}
