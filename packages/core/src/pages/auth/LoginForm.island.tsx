import { createSignal } from "solid-js";
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

  const resetPasswordHref = () => {
    const params = new URLSearchParams();
    if (username()) params.set("ipa-uid", username());
    if (props.redirectTo) params.set("redirectTo", props.redirectTo);
    return params.size > 0 ? `/auth/new-password?${params.toString()}` : "/auth/new-password";
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate({});
      }}
      class="flex flex-col gap-4"
    >
      {props.showBanner && <div class="info-block-info">Use your FreeIPA username and password to sign in to {props.appName || "the app"}.</div>}

      <TextInput
        label="Username"
        description="Use your organization short name, for example your FreeIPA uid."
        placeholder="e.g. eva"
        icon="ti ti-user"
        value={username}
        onChange={setUsername}
        autocomplete="username"
      />
      <div class="flex flex-col gap-1">
        <TextInput
          label="Password"
          description="Use the password for your organization account."
          placeholder="FreeIPA password"
          icon="ti ti-lock"
          password
          value={password}
          onChange={setPassword}
          autocomplete="current-password"
        />
        <a href={resetPasswordHref()} class="self-start text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline">
          Reset password
        </a>
      </div>

      {mutation.error() && (
        <div class="info-block-danger">
          <span>{mutation.error()?.message}</span>
        </div>
      )}

      <button type="submit" class="btn-primary w-full justify-center py-2" disabled={mutation.loading()}>
        {mutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-login-2" />}
        Sign in with FreeIPA
      </button>
    </form>
  );
}
