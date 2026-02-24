import { mutation as mutations } from "@valentinkolb/cloud/lib/browser";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { apiClient } from "@/accounts/client";
import { refreshCurrentPath } from "../lib/navigation";

type DenyRequestProps = {
  requestId: string;
  email: string;
  firstName: string;
};

export default function DenyRequest(props: DenyRequestProps) {
  const mutation = mutations.create<void, { reason?: string }>({
    mutation: async (vars) => {
      const res = await apiClient["account-requests"][":id"].deny.$post({
        param: { id: props.requestId },
        json: vars,
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to deny request.");
      }
    },
    onSuccess: () => {
      refreshCurrentPath();
    },
    onError: (err) => prompts.error(err.message),
  });

  const handleClick = async () => {
    const result = await prompts.form({
      title: "Deny Account Request",
      icon: "ti ti-x",
      confirmText: "Deny Request",
      fields: {
        info: {
          type: "info",
          content: () => (
            <div class="info-block-warning text-xs">
              Are you sure you want to deny the request from <strong>{props.firstName}</strong> ({props.email})?
            </div>
          ),
        },
        reason: {
          type: "text",
          multiline: true,
          label: "Reason (optional)",
          placeholder: "Explain why the request was denied...",
          description: "If provided, an email with this reason will be sent to the user.",
        },
      },
    });

    if (result !== null) {
      await mutation.mutate({
        reason: result.reason || undefined,
      });
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={mutation.loading()}
      class="btn-simple text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 px-3 py-1.5"
    >
      {mutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-x" />}
      <span>Deny</span>
    </button>
  );
}
