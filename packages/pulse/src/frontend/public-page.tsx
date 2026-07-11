import { getDateConfig, type AuthContext } from "@valentinkolb/cloud/server";
import { ssr } from "../config";
import { pulseService } from "../service";
import PublicPulseDashboard from "./PublicPulseDashboard.island";
import { parsePublicDashboardDisplayHeight, parsePublicDashboardTheme } from "./public-dashboard-runtime";

export default ssr<AuthContext>(async (c) => {
  c.header("Referrer-Policy", "no-referrer");
  const token = c.req.param("token") ?? "";
  const theme = parsePublicDashboardTheme(c.req.query("theme"));
  const displayHeight = parsePublicDashboardDisplayHeight(c.req.query("height"));
  c.get("page").theme = theme;
  const snapshot = await pulseService.dashboard.publicSnapshot(token);
  if (!snapshot.ok) {
    return () => (
      <main class="flex min-h-screen items-center justify-center bg-zinc-50 p-6 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
        <section class="paper max-w-md p-6 text-center">
          <h1 class="text-xl font-semibold">Dashboard not found</h1>
          <p class="mt-2 text-sm text-dimmed">{snapshot.error.message}</p>
        </section>
      </main>
    );
  }

  const dateConfig = getDateConfig(c);

  return () => (
    <PublicPulseDashboard
      token={token}
      initialSnapshot={snapshot.data}
      initialDateConfig={dateConfig}
      displayHeight={displayHeight}
    />
  );
});
