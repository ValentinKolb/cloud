import { createSignal } from "solid-js";
import { apiClient } from "@/api/api-client";
import {TextInput } from "@valentinkolb/cloud-lib/ui";
import { mutation as mutations } from "@valentinkolb/cloud-lib/browser";

type NewPasswordFormProps = {
  defaultUsername: string;
};

/** Form for changing an expired/temporary password. */
export default function NewPasswordForm(props: NewPasswordFormProps) {
  const [username, setUsername] = createSignal(props.defaultUsername);
  const [currentPassword, setCurrentPassword] = createSignal("");
  const [newPassword, setNewPassword] = createSignal("");
  const [confirmPassword, setConfirmPassword] = createSignal("");

  const mutation = mutations.create({
    mutation: async () => {
      if (newPassword() !== confirmPassword()) {
        throw new Error("Passwords do not match");
      }
      const res = await apiClient.auth["change-password"].$post({
        json: {
          username: username(),
          currentPassword: currentPassword(),
          newPassword: newPassword(),
          confirmPassword: confirmPassword(),
        },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error("message" in data ? data.message : "Failed to change password");
      }
    },
    onSuccess: () => {
      window.location.href = "/";
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
      <TextInput placeholder="Username" icon="ti ti-user" value={username} onChange={setUsername} />

      <TextInput placeholder="Current password" icon="ti ti-lock" password value={currentPassword} onChange={setCurrentPassword} />

      <TextInput placeholder="New password" icon="ti ti-lock-open" password value={newPassword} onChange={setNewPassword} />

      <TextInput
        placeholder="Confirm new password"
        icon="ti ti-lock-check"
        password
        value={confirmPassword}
        onChange={setConfirmPassword}
      />

      {mutation.error() && (
        <div class="info-block-danger">
          <span>{mutation.error()?.message}</span>
        </div>
      )}

      <button type="submit" class="btn-primary w-full justify-center py-2" disabled={mutation.loading()} style={{ "min-height": "32px" }}>
        {mutation.loading() ? (
          <i class="ti ti-loader-2 animate-spin" />
        ) : (
          <>
            <i class="ti ti-lock-check" />
            <span>Set Password</span>
          </>
        )}
      </button>
    </form>
  );
}
