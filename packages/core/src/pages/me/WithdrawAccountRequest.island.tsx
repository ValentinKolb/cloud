import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { prompts } from "@valentinkolb/cloud/ui";
import { apiClient } from "@valentinkolb/cloud/clients/core";

export default function WithdrawAccountRequest() {
  const mutation = mutations.create<void, void>({
    mutation: async () => {
      const res = await apiClient.me["account-request"].$delete();
      if (!res.ok) {
        const data = (await res.json()) as { message?: string };
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
      class="btn-secondary btn-sm inline-flex items-center gap-1 leading-none"
    >
      {mutation.loading() ? <i class="ti ti-loader-2 animate-spin text-sm" /> : <i class="ti ti-x text-sm" />}
      Withdraw Request
    </button>
  );
}
