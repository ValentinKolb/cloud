import { mutation as mutations } from "@k2b/stdlib/solid";
import { NoticeCard, Button } from "@k2b/ui";
import { apiClient } from "@valentinkolb/cloud/clients/core";
import { createSignal } from "solid-js";
import { PasswordSetupFields } from "../PasswordSetupFields";

type PasswordResetCompleteFormProps = {
  token: string;
  redirectTo?: string;
};

export default function PasswordResetCompleteForm(props: PasswordResetCompleteFormProps) {
  const [newPassword, setNewPassword] = createSignal("");
  const [confirmPassword, setConfirmPassword] = createSignal("");

  const mutation = mutations.create({
    mutation: async () => {
      const res = await apiClient.auth["password-reset"].complete.$post({
        json: {
          token: props.token,
          newPassword: newPassword(),
          confirmPassword: confirmPassword(),
          acceptedAgb: true,
        },
      });
      const data = (await res.json().catch(() => null)) as {
        message?: string;
      } | null;
      if (!res.ok) {
        throw new Error(data?.message ?? "Failed to reset password.");
      }
    },
    onSuccess: () => {
      window.location.href = props.redirectTo || "/";
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate({});
      }}
      class="flex flex-col gap-4"
    >
      <PasswordSetupFields
        newPassword={newPassword}
        confirmPassword={confirmPassword}
        onNewPasswordChange={setNewPassword}
        onConfirmPasswordChange={setConfirmPassword}
      />

      {mutation.error() && (
        <NoticeCard tone="danger" icon={false}>
          <span>{mutation.error()?.message}</span>
        </NoticeCard>
      )}

      <Button type="submit" class="w-full justify-center py-2" loading={mutation.loading()} loadingLabel="Resetting password">
        {mutation.loading() ? (
          <i class="ti ti-loader-2 animate-spin" />
        ) : (
          <>
            <i class="ti ti-lock-check" />
            <span>Set password</span>
          </>
        )}
      </Button>
    </form>
  );
}
