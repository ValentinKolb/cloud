import type { MutationResult } from "../../contracts/shared";
import { getFreeIpaConfig } from "../freeipa-config";

type MutationError = Extract<MutationResult<unknown>, { ok: false }>;

export const getIpaUrl = async (): Promise<string> => (await getFreeIpaConfig()).url;

export const ensureFreeIpaMutationAvailable = async (): Promise<MutationError | null> => {
  const config = await getFreeIpaConfig();
  if (!config.enabled) {
    return { ok: false, error: "FreeIPA is disabled.", status: 400 };
  }
  if (!config.configured) {
    return { ok: false, error: "FreeIPA is enabled but not fully configured.", status: 500 };
  }
  return null;
};
