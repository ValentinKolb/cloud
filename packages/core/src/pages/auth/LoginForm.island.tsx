import { createSignal } from "solid-js";
import {TextInput } from "@valentinkolb/cloud-lib/ui";
import { cookies, mutation as mutations } from "@valentinkolb/cloud-lib/browser";
import { apiClient } from "@/api/api-client";

export default function LoginForm(props: { redirectTo?: string; showBanner?: boolean; defaultUsername?: string; appName?: string }) {
  const [username, setUsername] = createSignal(props.defaultUsername ?? "");
  const [password, setPassword] = createSignal("");

  const mutation = mutations.create({
    mutation: async () => {
      const res = await apiClient.auth.login.$post({
        json: { username: username(), password: password(), acceptedAgb: true },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        if (data && "passwordExpired" in data && data.passwordExpired) {
          window.location.href = `/auth/new-password?ipa-uid=${encodeURIComponent(username())}`;
          throw new Error("Password expired — redirecting...");
        }
        throw new Error((data as any)?.message ?? `Login failed (${res.status})`);
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
      {props.showBanner && <div class="info-block-info">Please login with your {props.appName || ""} username and password.</div>}

      <TextInput placeholder="Short ID (three letters, aka Kürzel)" icon="ti ti-user" value={username} onChange={setUsername} />
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
