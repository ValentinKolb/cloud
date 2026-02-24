import { ssr } from "@valentinkolb/cloud/core/config";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { Layout } from "@valentinkolb/cloud/core/ssr";

/** OAuth error page shown when authorization fails. */
export default ssr<AuthContext>(async (c) => {
  const error = c.req.query("error") ?? "unknown_error";
  const errorDescription = c.req.query("error_description") ?? "An unknown error occurred.";
  const clientName = c.req.query("client_name");

  return (
    <Layout c={c} title={[{ title: "Authorization Error" }]}>
      <div class="max-w-md mx-auto flex flex-col gap-6">
        <div class="paper p-6 text-center">
          <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <i class="ti ti-shield-x text-3xl text-red-500" />
          </div>

          <h1 class="text-xl font-bold text-primary mb-2">Authorization Failed</h1>

          {clientName && (
            <p class="text-sm text-dimmed mb-4">
              Application: <span class="font-medium text-primary">{clientName}</span>
            </p>
          )}

          <p class="text-sm text-dimmed mb-6">{errorDescription}</p>

          <div class="text-xs text-dimmed bg-zinc-100 dark:bg-zinc-800 rounded px-3 py-2 mb-6">
            Error code: <code>{error}</code>
          </div>

          <a href="/" class="btn btn-primary">
            <i class="ti ti-home" />
            Back to Home
          </a>
        </div>
      </div>
    </Layout>
  );
});
