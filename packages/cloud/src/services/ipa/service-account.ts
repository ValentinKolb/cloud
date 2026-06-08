import type { MutationResult } from "../../contracts/shared";
import { providers } from "../providers";
import { getFreeIpaConfig } from "../freeipa-config";

export const getServiceIpaSession = async (): Promise<MutationResult<string>> => {
  if (!(await getFreeIpaConfig()).enabled) {
    return { ok: false, error: "FreeIPA is disabled.", status: 400 };
  }

  try {
    return { ok: true, data: await providers.ipa.auth.getServiceSession() };
  } catch {
    return { ok: false, error: "Internal FreeIPA service session unavailable.", status: 500 };
  }
};
