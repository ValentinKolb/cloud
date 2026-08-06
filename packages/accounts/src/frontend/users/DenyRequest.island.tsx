import { refreshCurrentPath } from "@k2b/ssr/nav";
import { mutation as mutations } from "@k2b/stdlib/solid";
import { NoticeCard, Button, prompts } from "@k2b/ui";
import { apiClient } from "@/api/client";

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
            <NoticeCard tone="warning" icon={false}>
              Are you sure you want to deny the request from <strong>{props.firstName}</strong> ({props.email})?
            </NoticeCard>
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
    <Button size="sm" variant="danger" onClick={handleClick} disabled={mutation.loading()}>
      {mutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-x" />}
      <span>Deny</span>
    </Button>
  );
}
