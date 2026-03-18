import { mutation as mutations } from "@valentinkolb/cloud/lib/browser";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { apiClient } from "@/faq/client";
import type { FaqAudience } from "@/faq/contracts";
import { refreshCurrentPath } from "../lib/navigation";

type Props = {
  /** If provided, edit mode with prefilled values */
  id?: string;
  question?: string;
  answer?: string;
  audience?: FaqAudience[];
};

const getErrorMessage = async (response: Response, fallback: string) => {
  const data = (await response.json().catch(() => null)) as { message?: string } | null;
  return data?.message ?? fallback;
};

const FaqForm = (props: Props) => {
  const isEdit = !!props.id;
  const defaultAudience = props.audience ?? ["user", "guest", "anonymous"];

  const mutation = mutations.create<void, void>({
    mutation: async () => {
      const result = await prompts.form({
        title: isEdit ? "Edit FAQ" : "New FAQ",
        icon: isEdit ? "ti ti-edit" : "ti ti-plus",
        fields: {
          question: {
            type: "text",
            label: "Question",
            placeholder: "Enter question...",
            default: props.question ?? "",
            required: true,
          },
          answer: {
            type: "text",
            label: "Answer (Markdown)",
            placeholder: "Write the answer in Markdown...",
            default: props.answer ?? "",
            multiline: true,
            required: true,
          },
          user: {
            type: "boolean",
            label: "Users",
            default: defaultAudience.includes("user"),
          },
          guest: {
            type: "boolean",
            label: "Guests",
            default: defaultAudience.includes("guest"),
          },
          anonymous: {
            type: "boolean",
            label: "Not signed in",
            default: defaultAudience.includes("anonymous"),
          },
        },
        confirmText: isEdit ? "Save" : "Create",
      });

      if (!result) return;

      const audience: FaqAudience[] = [];
      if (result.user) audience.push("user");
      if (result.guest) audience.push("guest");
      if (result.anonymous) audience.push("anonymous");

      if (!result.question.trim() || !result.answer.trim() || audience.length === 0) {
        throw new Error("Please fill in all fields and select at least one audience.");
      }

      if (isEdit) {
        const res = await apiClient[":id"].$patch({
          param: { id: props.id! },
          json: {
            question: result.question,
            answer: result.answer,
            audience,
          },
        });
        if (!res.ok) throw new Error(await getErrorMessage(res, "Failed to update FAQ"));
      } else {
        const res = await apiClient.index.$post({
          json: {
            question: result.question,
            answer: result.answer,
            audience,
          },
        });
        if (!res.ok) throw new Error(await getErrorMessage(res, "Failed to create FAQ"));
      }
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (err) => prompts.error(err.message),
  });

  return (
    <button
      type="button"
      class={isEdit ? "btn-simple btn-sm" : "btn-primary btn-sm"}
      onClick={() => mutation.mutate()}
      disabled={mutation.loading()}
    >
      {mutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class={isEdit ? "ti ti-edit" : "ti ti-plus"} />}
      {isEdit ? "Edit" : "New FAQ"}
    </button>
  );
};

export default FaqForm;
