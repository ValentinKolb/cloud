import { createRuntimeContext, runSetupPhase } from "@/runtime";

const run = async (): Promise<void> => {
  const apps: [] = [];
  const runtime = createRuntimeContext(apps);
  await runSetupPhase({ apps, runtime, skipSetup: false });
};

if (import.meta.main) {
  await run();
}
