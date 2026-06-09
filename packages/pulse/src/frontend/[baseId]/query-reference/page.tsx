import type { AuthContext } from "@valentinkolb/cloud/server";
import { ssr } from "../../../config";
import { pulseService } from "../../../service";
import PulseQueryReferenceWindow from "../../PulseQueryReferenceWindow.island";

export default ssr<AuthContext>(async (c) => {
  c.get("page").title = "Pulse query reference";
  const user = c.get("user");
  const baseId = c.req.param("baseId") ?? "";
  const baseResult = await pulseService.base.get(baseId, user);

  if (!baseResult.ok) {
    return () => (
      <main class="min-h-screen bg-zinc-50 p-6 dark:bg-zinc-950">
        <div class="paper mx-auto mt-16 max-w-md p-8 text-center text-dimmed">{baseResult.error.message}</div>
      </main>
    );
  }

  const [metricsResult, eventsResult, statesResult] = await Promise.all([
    pulseService.query.metrics(baseResult.data.id, user, {}),
    pulseService.query.recentEvents(baseResult.data.id, user, {}),
    pulseService.query.currentStates(baseResult.data.id, user, {}),
  ]);

  return () => (
    <PulseQueryReferenceWindow
      baseName={baseResult.data.name}
      metrics={metricsResult.ok ? metricsResult.data : []}
      events={eventsResult.ok ? eventsResult.data : []}
      states={statesResult.ok ? statesResult.data : []}
    />
  );
});
