import { createSignal } from "solid-js";
import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import { TextInput } from "@valentinkolb/cloud/ui";
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
          const params = new URLSearchParams({ "ipa-uid": username() });
          if (props.redirectTo) params.set("redirectTo", props.redirectTo);
          window.location.href = `/auth/new-password?${params.toString()}`;
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

  const passkeyMutation = mutations.create({
    mutation: async () => {
      if (!browserSupportsWebAuthn()) throw new Error("This browser does not support passkeys.");
      const optionsRes = await apiClient.auth.passkeys.authentication.start.$post();
      const options = await optionsRes.json();
      if (!optionsRes.ok) throw new Error((options as { message?: string }).message ?? "Failed to start passkey login.");

      const response = await startAuthentication({ optionsJSON: options as never });
      const verifyRes = await apiClient.auth.passkeys.authentication.verify.$post({
        json: { response, acceptedAgb: true },
      });
      if (!verifyRes.ok) {
        const data = (await verifyRes.json().catch(() => null)) as { message?: string } | null;
        throw new Error(data?.message ?? "Passkey login failed.");
      }
    },
    onSuccess: () => {
      cookies.writeCookie("login_method", "passkey");
      window.location.href = props.redirectTo || "/";
    },
  });

  const error = () => passkeyMutation.error() ?? mutation.error();
  const loading = () => mutation.loading() || passkeyMutation.loading();

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

      {error() && (
        <div class="info-block-danger">
          <span>{error()?.message}</span>
        </div>
      )}

      <button type="submit" class="btn-primary w-full justify-center py-2" disabled={loading()}>
        {mutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : "Sign In"}
      </button>

      <button
        type="button"
        class="btn-secondary w-full justify-center py-2"
        disabled={loading()}
        onClick={() => passkeyMutation.mutate({})}
      >
        {passkeyMutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-fingerprint" />}
        Sign in with passkey
      </button>
    </form>
  );
}
