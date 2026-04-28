import { ssr } from "../../config";
import LoginForm from "./LoginForm.island";
import GuestLoginForm from "./GuestLoginForm.island";
import AdminLoginForm from "./AdminLoginForm.island";
import { coreSettings } from "@valentinkolb/cloud/services";
import { listLegalLinks } from "@valentinkolb/cloud";

/** Login page. */
export default ssr(async (c) => {
  const [rawAppName, freeIpaEnabledRaw, allowSelfRegistrationRaw, legalLinks] = await Promise.all([
    coreSettings.get<string>("app.name"),
    coreSettings.get<boolean>("freeipa.enable"),
    coreSettings.get<boolean>("user.allow_self_registration"),
    listLegalLinks(),
  ]);
  const appName = rawAppName || "My App";
  const freeIpaEnabled = Boolean(freeIpaEnabledRaw);
  const allowSelfRegistration = Boolean(allowSelfRegistrationRaw);
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
  const isGuestHidden = freeIpaEnabled && hide === "guest";

  // Admin login: hidden method, no switch link, no cookie interaction
  const isAdminLogin = method === "admin";

  // Priority: hide=guest forces ipa > ?method= > cookie > fallback email
  const activeMethod = !freeIpaEnabled
    ? "email"
    : isGuestHidden
      ? "ipa"
      : method === "ipa" || method === "email"
        ? method
        : cookieMethod === "ipa" || cookieMethod === "email"
          ? cookieMethod
          : "email";

  const isEmailLogin = activeMethod === "email";

  // Build switch URL preserving all relevant params
  const switchMethod = isEmailLogin ? "ipa" : "email";
  const switchParams = new URLSearchParams();
  switchParams.set("method", switchMethod);
  if (redirectTo) switchParams.set("redirectTo", redirectTo);
  if (hide && freeIpaEnabled) switchParams.set("hide", hide);
  const switchUrl = `/auth/login?${switchParams.toString()}`;

  return () => (
    <div class="flex min-h-screen items-center justify-center bg-zinc-50 p-4 dark:bg-zinc-950">
      <div class="flex flex-col items-center gap-4 w-full max-w-sm">
        {/* Logo */}
        <img src="/branding/logo" alt={appName} width="48" height="48" style={{ "view-transition-name": "logo" }} />

        {/* Title */}
        <h1 class="text-xl font-bold" style={{ "view-transition-name": "page-title" }}>
          {isAdminLogin ? "Admin" : isEmailLogin ? "Sign in with email" : "Sign in with FreeIPA"}
        </h1>

        {/* Form */}
        <div class="paper w-full p-6" style={{ "view-transition-name": "login-card" }}>
          {isAdminLogin ? (
            <AdminLoginForm redirectTo={redirectTo} />
          ) : isEmailLogin ? (
            <GuestLoginForm redirectTo={redirectTo} token={token} allowSelfRegistration={allowSelfRegistration} />
          ) : (
            <LoginForm redirectTo={redirectTo} showBanner={hasBanner === "true"} defaultUsername={ipaUid} appName={appName} />
          )}
        </div>

        {/* Switch link - hidden for admin method and when guest login is disabled */}
        {!isAdminLogin && freeIpaEnabled && !isGuestHidden && (
          <a href={switchUrl} class="text-xs text-dimmed hover:text-primary underline" style={{ "view-transition-name": "login-switch" }}>
            {isEmailLogin ? "Sign in with FreeIPA instead" : "Sign in with email instead"}
          </a>
        )}

        {/* Footer — legal/info links contributed by every running app via
            `defineApp.legalLinks`. Aggregated server-side. */}
        <div class="text-center text-xs text-dimmed">
          {legalLinks.map((link, i) => (
            <>
              {i > 0 ? " · " : null}
              <a href={link.href} target="_blank" class="hover:text-primary">
                {link.label}
              </a>
            </>
          ))}
        </div>
      </div>
    </div>
  );
});
