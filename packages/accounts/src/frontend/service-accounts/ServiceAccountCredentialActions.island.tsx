import { refreshCurrentPath } from "@k2b/ssr/nav";
import { mutation as mutations } from "@k2b/stdlib/solid";
import { prompts, RemoveButton } from "@k2b/ui";
import { apiClient } from "@/api/client";

type Props = {
  credentialId: string;
  name: string;
  disabled?: boolean;
};

export default function ServiceAccountCredentialActions(props: Props) {
  const revokeMutation = mutations.create<void, void>({
    mutation: async () => {
      const res = await apiClient["service-accounts"].credentials[":id"].$delete({
        param: { id: props.credentialId },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to revoke API key.");
      }
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (error) => prompts.error(error.message),
  });

  const revoke = async () => {
    const confirmed = await prompts.confirm(
      `Revoke API key "${props.name}"? Existing clients using this key will stop working immediately.`,
      {
        title: "Revoke API key",
        icon: "ti ti-key-off",
        confirmText: "Revoke",
        cancelText: "Cancel",
        variant: "danger",
      },
    );
    if (confirmed) await revokeMutation.mutate();
  };

  return (
    <RemoveButton
      ariaLabel={`Revoke API key ${props.name}`}
      onClick={revoke}
      loading={revokeMutation.loading()}
      disabled={props.disabled}
    />
  );
}
