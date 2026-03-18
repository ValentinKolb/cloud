import { mutation as mutations } from "@valentinkolb/cloud/lib/browser";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { apiClient } from "@/accounts/client";

type WithdrawAccountRequestProps = {
  requestId: string;
};

export default function WithdrawAccountRequest(props: WithdrawAccountRequestProps) {
  const mutation = mutations.create<void, void>({
    mutation: async () => {
      const res = await apiClient["account-requests"][":id"].$delete({
        param: { id: props.requestId },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to withdraw request.");
      }
    },
    onSuccess: () => window.location.reload(),
    onError: (err) => prompts.error(err.message),
  });

  const handleClick = async () => {
    const confirmed = await prompts.confirm("Are you sure you want to withdraw your FreeIPA account request?", {
      title: "Withdraw Request",
      icon: "ti ti-x",
      confirmText: "Withdraw",
      cancelText: "Cancel",
      variant: "danger",
    });

    if (confirmed) {
      await mutation.mutate();
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={mutation.loading()}
      class="btn-simple text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 inline-flex items-center gap-1 leading-none"
    >
      {mutation.loading() ? <i class="ti ti-loader-2 animate-spin text-sm" /> : <i class="ti ti-x text-sm" />}
      Withdraw
    </button>
  );
}
