import { ssr } from "@config";
import LoginForm from "./LoginForm.island";
import GuestLoginForm from "./GuestLoginForm.island";
import { getSync } from "@valentinkolb/cloud-core/services/settings";

/** Login page. */
export default ssr((c) => {
  const appName = getSync<string>("app.name") || "My App";
  const params = new URL(c.req.url).searchParams;
  const redirectTo = params.get("redirectTo") ?? undefined;
  const token = params.get("token") ?? undefined;
  const method = params.get("method") ?? undefined;
  const hasBanner = params.get("banner") ?? undefined;
  const ipaUid = params.get("ipa-uid") ?? undefined;
  const hide = params.get("hide") ?? undefined;

  const cookie = c.req.raw.headers.get("Cookie") ?? "";
  const themeMatch = cookie.match(/theme=([^;]+)/);
  c.get("page").theme = themeMatch?.[1] === "dark" ? "dark" : "light";

  const loginMethodMatch = cookie.match(/login_method=([^;]+)/);
  const cookieMethod = loginMethodMatch?.[1] as "email" | "ipa" | undefined;

  // If guest is hidden, force IPA method
  const isGuestHidden = hide === "guest";

  // Priority: hide=guest forces ipa > ?method= > cookie > fallback email
  const activeMethod = isGuestHidden
    ? "ipa"
    : method === "ipa" || method === "email"
      ? method
      : cookieMethod === "ipa" || cookieMethod === "email"
        ? cookieMethod
        : "email";

  const isGuest = activeMethod === "email";

  // Build switch URL preserving all relevant params
  const switchMethod = isGuest ? "ipa" : "email";
  const switchParams = new URLSearchParams();
  switchParams.set("method", switchMethod);
  if (redirectTo) switchParams.set("redirectTo", redirectTo);
  if (hide) switchParams.set("hide", hide);
  const switchUrl = `/auth/login?${switchParams.toString()}`;

  return (
    <div class="flex min-h-screen items-center justify-center bg-zinc-50 p-4 dark:bg-zinc-950">
      <div class="flex flex-col items-center gap-4 w-full max-w-sm">
        {/* Logo */}
        <img src="/branding/logo" alt={appName} width="48" height="48" style={{ "view-transition-name": "logo" }} />

        {/* Title */}
        <h1 class="text-xl font-bold" style={{ "view-transition-name": "page-title" }}>
          {isGuest ? `${appName} Guest Login` : `${appName} Login`}
        </h1>

        {/* Form */}
        <div class="paper w-full p-6" style={{ "view-transition-name": "login-card" }}>
          {isGuest ? (
            <GuestLoginForm redirectTo={redirectTo} token={token} />
          ) : (
            <LoginForm redirectTo={redirectTo} showBanner={hasBanner === "true"} defaultUsername={ipaUid} appName={appName} />
          )}
        </div>

        {/* Switch link - hidden when guest login is disabled */}
        {!isGuestHidden && (
          <a href={switchUrl} class="text-xs text-dimmed hover:text-primary underline" style={{ "view-transition-name": "login-switch" }}>
            {isGuest ? `Sign in with ${appName} account` : "Sign in as guest with email"}
          </a>
        )}

        {/* Footer */}
        <div class="text-center text-xs text-dimmed">
          <a href="/impressum" target="_blank" class="hover:text-primary">
            Impressum
          </a>
          {" · "}
          <a href="/legal/datenschutz" target="_blank" class="hover:text-primary">
            Datenschutz
          </a>
          {" · "}
          <a href="/legal/agb" target="_blank" class="hover:text-primary">
            Nutzungsbedingungen
          </a>
          {" · "}
          <a href="/faq" target="_blank" class="hover:text-primary">
            FAQ
          </a>
        </div>
      </div>
    </div>
  );
});
