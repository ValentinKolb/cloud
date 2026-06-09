import { ssr } from "../../../config";
import NewPasswordForm from "./NewPasswordForm.island";
import { normalizeRedirectTo } from "@valentinkolb/cloud/shared";

/** Set new password page (for expired/temporary passwords). */
export default ssr((c) => {
  const params = new URL(c.req.url).searchParams;
  const user = params.get("ipa-uid") ?? "";
  const redirectTo = normalizeRedirectTo(params.get("redirectTo"));
  const loginParams = new URLSearchParams();
  if (redirectTo) loginParams.set("redirectTo", redirectTo);
  const loginHref = loginParams.size > 0 ? `/auth/login?${loginParams.toString()}` : "/auth/login";

  return () => (
    <div class="flex min-h-screen items-center justify-center bg-zinc-50 p-4 dark:bg-zinc-950">
      <div class="flex flex-col items-center gap-4 w-full max-w-sm">
        <div class="paper w-full p-8">
          <h1 class="text-2xl font-bold text-center mb-2">Set New Password</h1>
          <p class="text-sm text-dimmed text-center mb-6">Your password has expired or needs to be changed.</p>
          <NewPasswordForm defaultUsername={user} redirectTo={redirectTo} />
        </div>
        <a href={loginHref} class="text-xs text-dimmed hover:text-primary">
          Back to Sign In
        </a>
      </div>
    </div>
  );
});
