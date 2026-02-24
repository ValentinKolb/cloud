import { createRuntimeContext, runSetupPhase } from "@valentinkolb/cloud-core";
import { resolveBuiltInApps } from "./built-in-apps";
import { resolveRuntimeOptions } from "./runtime-options";

const run = async (): Promise<void> => {
  const options = resolveRuntimeOptions();

  const { apps } = resolveBuiltInApps(options.disabledApps);
  const runtime = createRuntimeContext(apps);

  console.log("[migrate] Running setup (core + app migrations)...");
  await runSetupPhase({ apps, runtime, skipSetup: options.skipSetup });
  console.log("[migrate] Setup complete");
};

if (import.meta.main) {
  await run();
}
