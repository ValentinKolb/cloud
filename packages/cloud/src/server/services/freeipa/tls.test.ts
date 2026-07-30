import { afterEach, describe, expect, test } from "bun:test";
import { getFreeIpaTls, getFreeIpaTlsFingerprint, setFreeIpaTlsResolver } from "./tls";

afterEach(() => setFreeIpaTlsResolver(null));

describe("FreeIPA TLS resolver", () => {
  test("defaults to explicit system verification without configuration wiring", async () => {
    setFreeIpaTlsResolver(null);
    expect(await getFreeIpaTls()).toEqual({ rejectUnauthorized: true });
    expect(await getFreeIpaTlsFingerprint()).toBe("sys");
  });

  test("keeps custom CA and insecure modes distinguishable for session rotation", async () => {
    setFreeIpaTlsResolver(async () => ({ ca: "certificate-a", rejectUnauthorized: true }));
    const first = await getFreeIpaTlsFingerprint();
    setFreeIpaTlsResolver(async () => ({ ca: "certificate-b", rejectUnauthorized: true }));
    const second = await getFreeIpaTlsFingerprint();
    setFreeIpaTlsResolver(async () => ({ rejectUnauthorized: false }));

    expect(first).not.toBe(second);
    expect(await getFreeIpaTlsFingerprint()).toBe("insec");
  });
});
