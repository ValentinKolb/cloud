import { mutation as mutations } from "@k2b/stdlib/solid";
import { NoticeCard, Button, TextInput } from "@k2b/ui";
import { apiClient } from "@valentinkolb/cloud/clients/core";
import { createSignal } from "solid-js";
import { PasswordSetupFields } from "../PasswordSetupFields";

type NewPasswordFormProps = {
  defaultUsername: string;
  redirectTo?: string;
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
      const res = await apiClient.auth["change-expired-password"].$post({
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
      <TextInput
        label="Username"
        description="Use your organization short name, for example your FreeIPA uid."
        placeholder="e.g. eva"
        icon="ti ti-user"
        value={username}
        onValueChange={setUsername}
        autocomplete="username"
      />

      <TextInput
        label="Current password"
        description="Enter the temporary or expired password you used to start this reset."
        placeholder="Current password"
        icon="ti ti-lock"
        password
        value={currentPassword}
        onValueChange={setCurrentPassword}
        autocomplete="current-password"
      />

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

      <Button type="submit" class="w-full justify-center py-2" loading={mutation.loading()} loadingLabel="Updating password">
        {mutation.loading() ? (
          <i class="ti ti-loader-2 animate-spin" />
        ) : (
          <>
            <i class="ti ti-lock-check" />
            <span>Set Password</span>
          </>
        )}
      </Button>
    </form>
  );
}
