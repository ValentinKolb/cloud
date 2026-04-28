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
        json: { email: email(), acceptedAgb: true },
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
          <div class="info-block-success">
            Check your email for the login code. If you normally sign in with a FreeIPA password, switch to FreeIPA sign-in instead.
          </div>

          <TextInput placeholder="Login code" icon="ti ti-key" value={tokenInput} onChange={setTokenInput} />

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
        <TextInput placeholder="Email address" icon="ti ti-mail" value={email} onChange={setEmail} />

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
          {emailMutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : "Send login code"}
        </button>

        <div class="text-xs text-dimmed text-center">
          {props.allowSelfRegistration
            ? "No local account yet? One will be created when you complete your first email sign-in."
            : "Only existing local accounts can sign in with email. Contact an administrator if you need access."}
        </div>
      </form>
    </Show>
  );
}
