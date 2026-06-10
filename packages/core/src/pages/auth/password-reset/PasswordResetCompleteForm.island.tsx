import { createSignal } from "solid-js";
import { apiClient } from "@valentinkolb/cloud/clients/core";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { PasswordSetupFields } from "../PasswordSetupFields";

type PasswordResetCompleteFormProps = {
  token: string;
  redirectTo?: string;
};

export default function PasswordResetCompleteForm(
  props: PasswordResetCompleteFormProps
) {
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
        <div class="info-block-danger">
          <span>{mutation.error()?.message}</span>
        </div>
      )}

      <button
        type="submit"
        class="btn-primary w-full justify-center py-2"
        disabled={mutation.loading()}
        style={{ "min-height": "32px" }}
      >
        {mutation.loading() ? (
          <i class="ti ti-loader-2 animate-spin" />
        ) : (
          <>
            <i class="ti ti-lock-check" />
            <span>Set password</span>
          </>
        )}
      </button>
    </form>
  );
}
