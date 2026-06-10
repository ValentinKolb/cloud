import { createSignal } from "solid-js";
import { apiClient } from "@valentinkolb/cloud/clients/core";
import { TextInput } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";

type PasswordResetRequestFormProps = {
  redirectTo?: string;
};

export default function PasswordResetRequestForm(
  props: PasswordResetRequestFormProps
) {
  const [email, setEmail] = createSignal("");
  const [sent, setSent] = createSignal(false);

  const mutation = mutations.create({
    mutation: async () => {
      const res = await apiClient.auth["password-reset"].request.$post({
        json: {
          email: email(),
          redirectTo: props.redirectTo,
          acceptedAgb: true,
        },
      });
      const data = (await res.json().catch(() => null)) as {
        message?: string;
      } | null;
      if (!res.ok) {
        throw new Error(data?.message ?? "Failed to request password reset.");
      }
      setSent(true);
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
      {sent() && (
        <div class="info-block-success">
          If this account can reset a password, a reset link has been sent. The
          link expires after 15 minutes.
        </div>
      )}

      <TextInput
        label="Email address"
        description="Use the email address attached to your organization account."
        placeholder="you@example.org"
        icon="ti ti-mail"
        type="email"
        value={email}
        onChange={setEmail}
        onInput={setEmail}
        autocomplete="email"
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
      >
        {mutation.loading() ? (
          <i class="ti ti-loader-2 animate-spin" />
        ) : (
          <i class="ti ti-send" />
        )}
        Send reset link
      </button>
    </form>
  );
}
