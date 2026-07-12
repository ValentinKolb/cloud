import { lookup as dnsLookup } from "node:dns/promises";
import { isUnsafeNetworkAddress, isUnsafeNetworkHostname, networkAddressFamily, normalizeNetworkHostname } from "../shared/network-address";

export type PublicNetworkAddress = { address: string; family: 4 | 6 };
export type NetworkLookup = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<Array<{ address: string; family: number }>>;

export const resolvePublicNetworkAddresses = async (
  rawHostname: string,
  lookup: NetworkLookup = (hostname) => dnsLookup(hostname, { all: true, verbatim: true }),
): Promise<PublicNetworkAddress[]> => {
  const hostname = normalizeNetworkHostname(rawHostname);
  if (!hostname || isUnsafeNetworkHostname(hostname)) throw new Error("Network target host is not allowed");

  const literalFamily = networkAddressFamily(hostname);
  const addresses = literalFamily ? [{ address: hostname, family: literalFamily }] : await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0) throw new Error("Network target could not be resolved");

  const normalized: PublicNetworkAddress[] = addresses.map((entry) => {
    const address = normalizeNetworkHostname(entry.address);
    if (entry.family !== 4 && entry.family !== 6) throw new Error("Network target returned an unsupported address family");
    if (networkAddressFamily(address) !== entry.family) throw new Error("Network target returned an invalid address");
    return { address, family: entry.family };
  });
  if (normalized.some((entry) => isUnsafeNetworkAddress(entry.address))) {
    throw new Error("Network target resolved to a private or reserved address");
  }
  return normalized;
};
