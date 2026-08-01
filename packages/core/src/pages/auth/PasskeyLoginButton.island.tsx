import { cookies } from "@k2b/stdlib/browser";
import { mutation as mutations } from "@k2b/stdlib/solid";
import { Button } from "@k2b/ui";
import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import { apiClient } from "@valentinkolb/cloud/clients/core";

export default function PasskeyLoginButton(props: { redirectTo?: string }) {
  const mutation = mutations.create({
    mutation: async () => {
      if (!browserSupportsWebAuthn()) throw new Error("This browser does not support passkeys.");

      const optionsRes = await apiClient.auth.passkeys.authentication.start.$post();
      const options = await optionsRes.json();
      if (!optionsRes.ok) throw new Error((options as { message?: string }).message ?? "Failed to start passkey login.");

      const response = await startAuthentication({
        optionsJSON: options as never,
      });
      const verifyRes = await apiClient.auth.passkeys.authentication.verify.$post({
        json: { response, acceptedAgb: true },
      });
      if (!verifyRes.ok) {
        const data = (await verifyRes.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(data?.message ?? "Passkey login failed.");
      }
    },
    onSuccess: () => {
      cookies.writeCookie("login_method", "passkey");
      window.location.href = props.redirectTo || "/";
    },
  });

  return (
    <div class="flex flex-col gap-2">
      <Button
        type="button"
        size="lg"
        class="h-12 w-full justify-center text-base"
        loading={mutation.loading()}
        loadingLabel="Signing in"
        onClick={() => mutation.mutate({})}
      >
        {mutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-key" />}
        Continue with passkey
      </Button>
      <p class="text-center text-xs text-dimmed">You can add passkeys from your profile page.</p>
      {mutation.error() && (
        <div class="info-block-danger">
          <span>{mutation.error()?.message}</span>
        </div>
      )}
    </div>
  );
}
