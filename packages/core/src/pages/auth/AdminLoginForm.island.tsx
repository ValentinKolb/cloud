import { createSignal } from "solid-js";
import { TextInput } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { apiClient } from "@valentinkolb/cloud/clients/core";

export default function AdminLoginForm(props: { redirectTo?: string }) {
  const [token, setToken] = createSignal("");

  const mutation = mutations.create({
    mutation: async () => {
      const res = await apiClient.auth["admin-login"].$post({
        json: { token: token() },
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(data?.message ?? `Login failed (${res.status})`);
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
        label="Admin token"
        description="Use the emergency token configured for this instance."
        placeholder="Admin token"
        icon="ti ti-key"
        password
        value={token}
        onChange={setToken}
        autocomplete="off"
      />

      {mutation.error() && (
        <div class="info-block-danger">
          <span>{mutation.error()?.message}</span>
        </div>
      )}

      <button type="submit" class="btn-primary w-full justify-center py-2" disabled={mutation.loading()}>
        {mutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-shield" />}
        Sign in with admin token
      </button>
    </form>
  );
}
