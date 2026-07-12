import { describe, expect, test } from "bun:test";
import { createPinnedLookup, EndpointPolicyError, isPublicIpAddress, resolvePublicEndpoint } from "./endpoint-policy";

describe("mail endpoint policy", () => {
  test("rejects private, loopback, documentation, multicast, and mapped-private addresses", () => {
    for (const address of [
      "0.0.0.0",
      "10.2.3.4",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.31.2.3",
      "192.168.1.1",
      "198.51.100.2",
      "224.0.0.1",
      "::",
      "::1",
      "::ffff:127.0.0.1",
      "64:ff9b::7f00:1",
      "64:ff9b:1::1",
      "100::1",
      "2001::1",
      "2001:2::1",
      "2001:20::1",
      "2001:db8::1",
      "2002::1",
      "3fff::1",
      "5f00::1",
      "fc00::1",
      "fe80::1",
      "fec0::1",
      "ff02::1",
    ]) {
      expect(isPublicIpAddress(address), address).toBe(false);
    }
  });

  test("allows globally routable IPv4 and IPv6 addresses", () => {
    expect(isPublicIpAddress("1.1.1.1")).toBe(true);
    expect(isPublicIpAddress("8.8.8.8")).toBe(true);
    expect(isPublicIpAddress("64:ff9b::808:808")).toBe(true);
    expect(isPublicIpAddress("2606:4700:4700::1111")).toBe(true);
    expect(isPublicIpAddress("2001:4860:4860::8888")).toBe(true);
  });

  test("rejects local hostnames before DNS", async () => {
    for (const host of ["localhost", "mail.local", "metadata.google.internal", "server.internal", "x.home.arpa"]) {
      await expect(resolvePublicEndpoint({ host, port: 993, tlsMode: "implicit" })).rejects.toBeInstanceOf(EndpointPolicyError);
    }
  });

  test("pins socket lookup to previously validated addresses", () => {
    const lookup = createPinnedLookup({
      host: "mail.example.com",
      port: 993,
      tlsMode: "implicit",
      addresses: [
        { address: "1.1.1.1", family: 4 },
        { address: "2606:4700:4700::1111", family: 6 },
      ],
    });

    const selected = new Promise<{ address: string; family: number | undefined }>((resolve, reject) => {
      lookup("mail.example.com", { family: 4 }, (error, address, family) => {
        if (error) reject(error);
        else resolve({ address: address as string, family });
      });
    });
    return expect(selected).resolves.toEqual({ address: "1.1.1.1", family: 4 });
  });
});
