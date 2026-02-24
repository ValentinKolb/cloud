import { serveCloudStandalone } from "./index";
import { resolveRuntimeOptions } from "./runtime-options";

const runtimeOptions = resolveRuntimeOptions();

export default await serveCloudStandalone({
  disabledApps: runtimeOptions.disabledApps,
  coreOptions: {
    skipSetup: runtimeOptions.skipSetup,
  },
});
