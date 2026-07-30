import { freeipa } from "../../server/services";
import { FreeIpaTransportError } from "../../server/services/freeipa/transport";
import { getFreeIpaConfig } from "../freeipa-config";

export type FreeIpaConnectionTestResult =
  | { ok: true }
  | {
      ok: false;
      status: 400 | 503;
      error: string;
      kind: "authentication" | "configuration" | "invalid_response" | "network" | "timeout" | "tls" | "upstream";
    };

export const testFreeIpaConnection = async (): Promise<FreeIpaConnectionTestResult> => {
  const config = await getFreeIpaConfig();
  if (!config.configured) {
    return {
      ok: false,
      status: 400,
      kind: "configuration",
      error: `FreeIPA is not fully configured. Check: ${config.missingSettings.join(", ")}.`,
    };
  }

  try {
    const login = await freeipa.session.login({
      url: config.url,
      username: config.serviceUser,
      password: config.servicePassword,
    });
    if (login.status !== "success") {
      return { ok: false, status: 400, kind: "authentication", error: "FreeIPA rejected the saved service account credentials." };
    }

    const ping = await freeipa.client.call({
      url: config.url,
      ipaSession: login.session,
      method: "ping",
      args: [],
    });
    if (ping.error) {
      return {
        ok: false,
        status: ping.error.code === 403 ? 400 : 503,
        kind: ping.error.code === 403 ? "authentication" : "upstream",
        error: ping.error.code === 403 ? "FreeIPA rejected the saved service account session." : "FreeIPA ping failed.",
      };
    }
    return { ok: true };
  } catch (error) {
    if (error instanceof FreeIpaTransportError) {
      const kind = error.kind === "aborted" ? "network" : error.kind;
      return { ok: false, status: 503, kind, error: error.message };
    }
    return { ok: false, status: 503, kind: "network", error: "FreeIPA connection test failed." };
  }
};
