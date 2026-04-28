import { createSignal } from "solid-js";
import {TextInput } from "@valentinkolb/cloud/ui";
import { cookies } from "@valentinkolb/stdlib/browser";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { apiClient } from "@valentinkolb/cloud/clients/core";

export default function LoginForm(props: { redirectTo?: string; showBanner?: boolean; defaultUsername?: string; appName?: string }) {
  const [username, setUsername] = createSignal(props.defaultUsername ?? "");
  const [password, setPassword] = createSignal("");

  const mutation = mutations.create({
    mutation: async () => {
      const res = await apiClient.auth.login.$post({
        json: { username: username(), password: password(), acceptedAgb: true },
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string; passwordExpired?: boolean } | null;
        if (data?.passwordExpired) {
          window.location.href = `/auth/new-password?ipa-uid=${encodeURIComponent(username())}`;
          throw new Error("Password expired — redirecting...");
        }
        throw new Error(data?.message ?? `Login failed (${res.status})`);
      }
    },
    onSuccess: () => {
      cookies.writeCookie("login_method", "ipa");
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
      {props.showBanner && <div class="info-block-info">Use your FreeIPA username and password to sign in to {props.appName || "the app"}.</div>}

      <TextInput placeholder="Username" icon="ti ti-user" value={username} onChange={setUsername} />
      <TextInput placeholder="Password" icon="ti ti-lock" password value={password} onChange={setPassword} />

      {mutation.error() && (
        <div class="info-block-danger">
          <span>{mutation.error()?.message}</span>
        </div>
      )}

      <button type="submit" class="btn-primary w-full justify-center py-2" disabled={mutation.loading()}>
        {mutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : "Sign In"}
      </button>
    </form>
  );
}
