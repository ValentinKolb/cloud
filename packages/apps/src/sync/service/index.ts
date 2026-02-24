import { ipa } from "@valentinkolb/cloud/core/services";
import { err, tryCatch } from "@valentinkolb/cloud/lib/server";

export const syncService = {
  ipa: {
    run: async (_config: Record<string, never> = {}) =>
      tryCatch(
        async () => {
          await ipa.sync.run();
        },
        (error) => err.internal(`Sync failed: ${error instanceof Error ? error.message : String(error)}`),
      ),
  },
};

export type SyncService = typeof syncService;
