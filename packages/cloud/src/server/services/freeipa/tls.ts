import { createHash } from "node:crypto";

/**
 * TLS resolver slot for FreeIPA transport (`client.ts`, `session.ts`).
 *
 * The transport layer cannot directly read settings (would create a cycle:
 * `services/freeipa-config.ts` already depends on `server/services/freeipa/`).
 * Instead, the layer that owns settings registers a resolver via
 * `setFreeIpaTlsResolver()` and the transport calls `getFreeIpaTls()` per fetch.
 *
 * Resolver is async — it reads through the Redis cache-aside settings layer.
 * Returns Bun fetch `tls` options. Without a registered settings resolver,
 * system trust remains explicitly verified.
 * Resolution order is the resolver's concern (typically: ca_cert > allow_insecure > system trust).
 */
// `BunFetchRequestInitTLS` is declared as a global (see bun-types/globals.d.ts)
// and not exported from the "bun" module. Use `Bun.TLSOptions` — fetch's `tls`
// option accepts it (the global extends it with `checkServerIdentity` which we
// don't need).
type FreeIpaTls = Bun.TLSOptions;

let resolver: (() => Promise<FreeIpaTls | undefined>) | null = null;

export const setFreeIpaTlsResolver = (fn: (() => Promise<FreeIpaTls | undefined>) | null): void => {
  resolver = fn;
};

export const getFreeIpaTls = async (): Promise<FreeIpaTls> => {
  return (await resolver?.()) ?? { rejectUnauthorized: true };
};

/**
 * Stable fingerprint of the current TLS config — used as a cache-key suffix
 * (e.g. for the cached service session) so that flipping `allow_insecure` or
 * rotating `ca_cert` forces re-establishment of cached connections.
 */
export const getFreeIpaTlsFingerprint = async (): Promise<string> => {
  const tls = await getFreeIpaTls();
  if (tls.ca && typeof tls.ca === "string" && tls.ca.length > 0) {
    return `ca:${createHash("sha256").update(tls.ca).digest("hex")}`;
  }
  if (tls.rejectUnauthorized === false) return "insec";
  return "sys";
};
