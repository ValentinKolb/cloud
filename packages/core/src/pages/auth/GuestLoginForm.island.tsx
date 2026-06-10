import { createSignal, Show, onMount } from "solid-js";
import {CheckboxInput,TextInput } from "@valentinkolb/cloud/ui";
import { cookies } from "@valentinkolb/stdlib/browser";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { apiClient } from "@valentinkolb/cloud/clients/core";

export default function GuestLoginForm(props: { redirectTo?: string; token?: string; allowSelfRegistration: boolean }) {
  const [email, setEmail] = createSignal("");
  const [acceptedAgb, setAcceptedAgb] = createSignal(!!props.token);
  const [tokenInput, setTokenInput] = createSignal(props.token ?? "");
  const [showTokenInput, setShowTokenInput] = createSignal(!!props.token);

  const emailMutation = mutations.create({
    mutation: async () => {
      if (!acceptedAgb()) throw new Error("Please accept the Terms of Service and Privacy Policy.");
      const res = await apiClient.auth["email-login"].$post({
        json: { email: email(), acceptedAgb: true, redirectTo: props.redirectTo },
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) throw new Error((data.message as string) ?? "Request failed");
    },
    onSuccess: () => setShowTokenInput(true),
  });

  const tokenMutation = mutations.create({
    mutation: async () => {
      if (!acceptedAgb()) throw new Error("Please accept the Terms of Service and Privacy Policy.");
      const res = await apiClient.auth["verify-token"].$post({
        json: { token: tokenInput(), acceptedAgb: true },
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(data?.message ?? "Invalid or expired token");
      }
    },
    onSuccess: () => {
      cookies.writeCookie("login_method", "email");
      window.location.href = props.redirectTo || "/";
    },
  });

  onMount(() => {
    if (props.token) tokenMutation.mutate({});
  });

  const error = () => (showTokenInput() ? tokenMutation.error() : emailMutation.error());
  const loading = () => emailMutation.loading() || tokenMutation.loading();

  return (
    <Show
      when={!showTokenInput()}
      fallback={
        <form
          onSubmit={(e) => {
            e.preventDefault();
            tokenMutation.mutate({});
          }}
          class="flex flex-col gap-4"
        >
          <div class="info-block-success">Check your email for the login code. The code expires after a few minutes.</div>

          <TextInput
            label="Login code"
            description="Enter the one-time code from your email."
            placeholder="Login code"
            icon="ti ti-key"
            value={tokenInput}
            onChange={setTokenInput}
            autocomplete="one-time-code"
          />

          {error() && (
            <div class="info-block-danger">
              <span>{error()?.message}</span>
            </div>
          )}

          <CheckboxInput
            label={
              <span>
                I accept the{" "}
                <a href="/legal/terms" target="_blank" class="text-primary hover:underline">
                  Terms of Service
                </a>
                {" "}and the{" "}
                <a href="/legal/privacy" target="_blank" class="text-primary hover:underline">
                  Privacy Policy
                </a>
              </span>
            }
            value={acceptedAgb}
            onChange={setAcceptedAgb}
          />

          <button type="submit" class="btn-primary w-full justify-center py-2" disabled={loading()}>
            {tokenMutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : "Verify"}
          </button>
        </form>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          emailMutation.mutate({});
        }}
        class="flex flex-col gap-4"
      >
        <TextInput
          label="Email address"
          description={
            props.allowSelfRegistration
              ? "Use your Cloud email address. A guest account will be created automatically on first login."
              : "Use the email address for your existing Cloud account."
          }
          placeholder="you@example.org"
          type="email"
          icon="ti ti-mail"
          value={email}
          onChange={setEmail}
          autocomplete="email"
        />

        {error() && (
          <div class="info-block-danger">
            <span>{error()?.message}</span>
          </div>
        )}

        <CheckboxInput
          label={
            <span>
              I accept the{" "}
              <a href="/legal/terms" target="_blank" class="text-primary hover:underline">
                Terms of Service
              </a>
              {" "}and the{" "}
              <a href="/legal/privacy" target="_blank" class="text-primary hover:underline">
                Privacy Policy
              </a>
            </span>
          }
          value={acceptedAgb}
          onChange={setAcceptedAgb}
        />

        <button type="submit" class="btn-primary w-full justify-center py-2" disabled={loading()}>
          {emailMutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-send" />}
          Send login link
        </button>

        <div class="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs leading-5 text-dimmed dark:border-zinc-800 dark:bg-zinc-900">
          {props.allowSelfRegistration
            ? "New to Cloud? Enter your email address. A guest account will be created automatically on first login."
            : "Email links only open existing accounts. Need a new account? Contact an administrator."}
        </div>
      </form>
    </Show>
  );
}
